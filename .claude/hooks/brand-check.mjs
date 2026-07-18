import fs from "node:fs";
import path from "node:path";

const input = await readStdinJson();
const filePath = input?.tool_input?.file_path;

if (!filePath || !isRelevant(filePath) || shouldSkip(filePath) || !fs.existsSync(filePath)) {
  process.exit(0);
}

let source;
try {
  source = fs.readFileSync(filePath, "utf8");
} catch {
  process.exit(0);
}

const issues = [];
const allowedHex = new Set([
  "#080b14", "#0b1020", "#0f1424", "#151d34",
  "#f7f9fc", "#ffffff", "#000000", "#667085", "#98a2b3", "#d0d5dd", "#eaecf0",
  "#b98cff", "#8a5cff", "#7b4dff", "#5b39ff",
  "#277bff", "#1da5ff", "#22d7f6",
  "#16a36a", "#d97706", "#dc2626", "#2563eb"
]);

const rawHex = [...source.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((match) => match[0].toLowerCase());
const unapproved = [...new Set(rawHex.filter((color) => !allowedHex.has(color)))];
if (unapproved.length) {
  issues.push(`Colores hex fuera del set aprobado: ${unapproved.slice(0, 8).join(", ")}${unapproved.length > 8 ? "…" : ""}. Usa tokens o documenta la excepción semántica.`);
}

const disallowedFonts = [...source.matchAll(/\b(Roboto|Poppins|Montserrat|Nunito|Lato|Open Sans|DM Sans)\b/gi)]
  .map((match) => match[0]);
if (disallowedFonts.length) {
  issues.push(`Tipografía no aprobada detectada: ${[...new Set(disallowedFonts)].join(", ")}. Vega usa Space Grotesk e Inter.`);
}

const clicheMatches = [...source.matchAll(/[✨🤖🧠🌟⭐]/gu)].map((match) => match[0]);
if (clicheMatches.length) {
  issues.push("Se han detectado emojis/destellos asociados a clichés de IA. No los uses como iconografía funcional ni como parte de la marca.");
}

const gradientCount = (source.match(/(?:linear|radial|conic)-gradient\s*\(/gi) || []).length;
if (gradientCount > 3 && !filePath.endsWith("tokens.css")) {
  issues.push(`Este archivo contiene ${gradientCount} gradientes. La identidad Vega reserva el degradado para acentos escasos; revisa si se está usando como decoración recurrente.`);
}

const glowCount = (source.match(/(?:drop-shadow|box-shadow|text-shadow)\s*[:(]/gi) || []).length;
if (glowCount > 6) {
  issues.push(`Este archivo contiene ${glowCount} usos de sombra. Prioriza bordes y una sola elevación neutra; evita glow y profundidad ornamental.`);
}

if (!issues.length) {
  process.exit(0);
}

const relative = path.relative(process.env.CLAUDE_PROJECT_DIR || process.cwd(), filePath);
const message = [
  `Comprobación de marca Vega para ${relative}:`,
  ...issues.map((issue, index) => `${index + 1}. ${issue}`),
  "Estas son advertencias heurísticas: verifica el contexto antes de cambiar código."
].join("\n");

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: message
  }
}));

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function isRelevant(file) {
  return /\.(css|scss|less|html|svg|tsx?|jsx?|vue|svelte|json|md)$/i.test(file);
}

function shouldSkip(file) {
  return /(?:^|[\\/])(node_modules|dist|build|coverage|\.next|\.nuxt|vendor|generated|snapshots?)(?:[\\/]|$)/i.test(file)
    || /(?:\.min\.(css|js)|\.lock)$/i.test(file);
}
