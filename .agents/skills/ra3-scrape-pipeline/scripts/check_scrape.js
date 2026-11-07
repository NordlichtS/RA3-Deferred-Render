#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const extensions = /\.scrape(?:h|o)?$/i;
const types = new Set(['surface', 'surfacegroup', 'texture', 'texture3d', 'texturecube', 'shader', 'scene', 'camera', 'matrix']);
const commands = new Set(`var staticvar proc endproc callproc return goto if ifnot elif elifnot else endif
settarget setdepth cleartarget setviewport setscissor setcamera setclearcolor setcleardepth clear clearcolor clearz
setshader setshaderoverride clearshaderoverride settexture settosize casttexture setfloat setint setbool
visibleobjects renderbin renderquad renderfullquad stretchrect beginevent endevent setmarker
beginDepthOverrideTechnique endDepthOverrideTechnique beginShadowOverrideTechnique endShadowOverrideTechnique
beginDepthNormalOverrideTechnique shadowMap.beginUpdate shadowMap.endUpdate setGlobalLightInfo resolve compresstexture
transferimage setgpr setfragmentshader clearbegintiling resolveendtiling renderTerrain renderRoads renderScorchMarks
renderTerrainTracks renderDecals renderProps renderUnits renderStructures renderBehindBuildingMarkers renderEditorObjects
renderWater renderWaterDisplacement renderRain renderParticles renderLasers renderDistortionLasers renderTracers
renderConnectionLines renderStreams renderTerrainUI renderTransparentOutlineObjects renderIconLayers renderUI
renderDebugSystems renderDebugDisplays renderTileFeedback renderDeferredLights renderDeferredLightsOverdraw
renderDefferedLightingDebug2D renderDefferedLightingDebug3D renderSpawnZoneEffect`.split(/\s+/));

function filesFrom(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return extensions.test(target) ? [path.resolve(target)] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => filesFrom(path.join(target, entry.name)));
}

function tokens(line) {
  return [...line.matchAll(/"(?:\\.|[^"\\])*"|[^\s]+/g)].map((match) => ({ text: match[0], start: match.index }));
}

function stripComments(line, state) {
  let out = '';
  let index = 0;
  let quote = false;
  while (index < line.length) {
    if (state.block) {
      const end = line.indexOf('*/', index);
      if (end < 0) return out;
      state.block = false;
      index = end + 2;
      continue;
    }
    if (line[index] === '"' && line[index - 1] !== '\\') quote = !quote;
    if (!quote && line.startsWith('//', index)) break;
    if (!quote && line.startsWith('/*', index)) {
      state.block = true;
      index += 2;
      continue;
    }
    out += line[index++];
  }
  return out;
}

const args = process.argv.slice(2).filter((arg) => arg !== '--json');
const json = process.argv.includes('--json');
if (args.length === 0) {
  console.error('Usage: node check_scrape.js [--json] <file-or-directory> [...]');
  process.exit(2);
}

const files = [...new Set(args.flatMap((arg) => filesFrom(path.resolve(arg))))];
const findings = [];
const definitions = new Map();
const macros = new Set();
const references = [];

function warn(file, line, column, code, message) {
  findings.push({ file, line: line + 1, column: column + 1, severity: 'warning', code, message });
}

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const comment = { block: false };
  const stack = [];
  const pp = [];
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const original = lines[lineNumber];
    if (Buffer.byteLength(`${original}\n`, 'utf8') >= 256) warn(file, lineNumber, 0, 'line-too-long', 'logical line reaches the 256-byte runtime buffer limit');
    const line = stripComments(original, comment);
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      const include = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(line);
      if (include) {
        const direct = path.resolve(path.dirname(file), include[1]);
        const present = fs.existsSync(direct) || files.some((candidate) => path.basename(candidate).toLowerCase() === path.basename(include[1]).toLowerCase());
        if (!present) warn(file, lineNumber, line.indexOf(include[1]), 'missing-include', `cannot resolve include ${include[1]}`);
        continue;
      }
      const define = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (define) {
        macros.add(define[1]);
        definitions.set(`macro:${define[1]}`, { file, line: lineNumber });
        continue;
      }
      const directive = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/.exec(line);
      if (directive) {
        if (['if', 'ifdef', 'ifndef'].includes(directive[1])) pp.push({ line: lineNumber, name: directive[1] });
        else if (['elif', 'else'].includes(directive[1]) && pp.length === 0) warn(file, lineNumber, 0, 'preprocessor-branch', `#${directive[1]} lacks an open preprocessor condition`);
        else if (directive[1] === 'endif' && !pp.pop()) warn(file, lineNumber, 0, 'preprocessor-close', '#endif lacks an open preprocessor condition');
      }
      continue;
    }
    const parts = tokens(line);
    if (!parts.length) continue;
    const name = parts[0].text;
    const values = parts.slice(1);
    if (name === ':') {
      if (values[0]) definitions.set(`label:${values[0].text}`, { file, line: lineNumber });
      continue;
    }
    if (!commands.has(name) && !/^[A-Z_][A-Z0-9_]*(?:\(.*)?$/.test(name)) warn(file, lineNumber, parts[0].start, 'unknown-command', `unknown lowercase SCRAPE command ${name}`);
    if (name === 'var' || name === 'staticvar') {
      if (!values[0] || !types.has(values[0].text)) warn(file, lineNumber, values[0]?.start || parts[0].start, 'unknown-type', `unknown or missing SCRAPE variable type ${values[0]?.text || ''}`);
      if (values[1]) {
        definitions.set(`variable:${values[1].text}`, { file, line: lineNumber, type: values[0]?.text });
        if (values[0]) definitions.set(`${values[0].text}:${values[1].text}`, { file, line: lineNumber, type: values[0].text });
      }
    } else if (name === 'proc') {
      if (stack.some((item) => item.kind === 'proc')) warn(file, lineNumber, parts[0].start, 'nested-proc', 'procedure definitions cannot nest');
      if (values[0]) definitions.set(`proc:${values[0].text}`, { file, line: lineNumber });
      stack.push({ kind: 'proc', line: lineNumber, name });
    } else if (name === 'if' || name === 'ifnot') stack.push({ kind: 'if', line: lineNumber, name, seenElse: false });
    else if (name === 'beginevent') stack.push({ kind: 'event', line: lineNumber, name });
    else if (['elif', 'elifnot', 'else'].includes(name)) {
      const top = stack.at(-1);
      if (!top || top.kind !== 'if') warn(file, lineNumber, parts[0].start, 'branch-placement', `${name} is not directly inside an open if`);
      else if (top.seenElse) warn(file, lineNumber, parts[0].start, 'branch-after-else', `${name} occurs after else`);
      else if (name === 'else') top.seenElse = true;
    } else if (name === 'endif' || name === 'endproc' || name === 'endevent') {
      const expected = name === 'endif' ? 'if' : name === 'endproc' ? 'proc' : 'event';
      const top = stack.pop();
      if (!top || top.kind !== expected) warn(file, lineNumber, parts[0].start, 'misnested-close', `${name} does not match the current open structure`);
    }
    if (name === 'callproc' && values[0]) references.push({ file, line: lineNumber, column: values[0].start, kind: 'proc', name: values[0].text });
    if (name === 'goto' && values[0]) references.push({ file, line: lineNumber, column: values[0].start, kind: 'label', name: values[0].text });
    if (name === 'setcamera' && values[0] && values[0].text !== 'NULL') references.push({ file, line: lineNumber, column: values[0].start, kind: 'camera', name: values[0].text });
    if (['setshader', 'setshaderoverride', 'clearshaderoverride'].includes(name) && values[0]) references.push({ file, line: lineNumber, column: values[0].start, kind: 'shader', name: values[0].text });
    if (name === 'settexture' && values[2]) references.push({ file, line: lineNumber, column: values[2].start, kind: 'texture', name: values[2].text });
  }
  if (comment.block) warn(file, lines.length - 1, 0, 'unclosed-comment', 'block comment lacks */');
  for (const open of stack) warn(file, open.line, 0, 'unclosed-structure', `${open.name} lacks its closing command`);
  for (const open of pp) warn(file, open.line, 0, 'unclosed-preprocessor', `#${open.name} lacks #endif`);
}

for (const ref of references) {
  const direct = definitions.get(`${ref.kind}:${ref.name}`);
  const typedVariable = ref.kind === 'texture' && ['texture', 'texture3d', 'texturecube'].some((kind) => definitions.has(`${kind}:${ref.name}`));
  if (!direct && !typedVariable && !macros.has(ref.name)) warn(ref.file, ref.line, ref.column, 'missing-definition', `cannot resolve ${ref.kind} ${ref.name}`);
}

if (json) console.log(JSON.stringify({ files: files.length, findings }, null, 2));
else {
  console.log(`Checked ${files.length} SCRAPE files; ${findings.length} warning(s).`);
  for (const item of findings) console.log(`${item.file}:${item.line}:${item.column} warning [${item.code}] ${item.message}`);
}
process.exitCode = findings.length ? 1 : 0;
