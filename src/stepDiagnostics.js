"use strict";

const COLLECTION_NAME = "gauge-kotlin";
const GAUGE_LANGUAGE = "gauge";
const KOTLIN_LANGUAGE = "kotlin";
const BLANK_STEP_MESSAGE = "Step should not be blank";
const PARAMETER_MISMATCH_PREFIX = "Parameter count mismatch";
const GAUGE_STEP_ANNOTATION = "com.thoughtworks.gauge.Step";
const KOTLIN_FUNCTION_MODIFIERS = new Set([
  "abstract",
  "actual",
  "expect",
  "external",
  "final",
  "infix",
  "inline",
  "internal",
  "open",
  "operator",
  "override",
  "private",
  "protected",
  "public",
  "suspend",
  "tailrec",
]);

function getVscode(vscode) {
  return vscode || require("vscode");
}

function createPosition(vscode, line, character) {
  if (typeof vscode.Position === "function") {
    return new vscode.Position(line, character);
  }
  return { line, character };
}

function createRange(vscode, start, end) {
  const startPosition = createPosition(vscode, start.line, start.character);
  const endPosition = createPosition(vscode, end.line, end.character);
  if (typeof vscode.Range === "function") {
    return new vscode.Range(startPosition, endPosition);
  }
  return { start: startPosition, end: endPosition };
}

function createDiagnostic(vscode, range, message) {
  const severity = vscode.DiagnosticSeverity && vscode.DiagnosticSeverity.Error;
  if (typeof vscode.Diagnostic === "function") {
    return new vscode.Diagnostic(range, message, severity);
  }
  return { range, message, severity };
}

function positionAt(text, offset) {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, character: offset - lineStart };
}

function findLineEnd(text, startIndex) {
  const lineEnd = text.indexOf("\n", startIndex);
  return lineEnd === -1 ? text.length : lineEnd;
}

function findQuotedEnd(text, startIndex, quote) {
  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
    } else if (char === quote) {
      return index + 1;
    }
  }
  return text.length;
}

function findBlockCommentEnd(text, startIndex) {
  let depth = 1;
  for (let index = startIndex + 2; index < text.length; index += 1) {
    if (text.startsWith("/*", index)) {
      depth += 1;
      index += 1;
    } else if (text.startsWith("*/", index)) {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return text.length;
}

function findCommentEnd(text, startIndex) {
  if (text.startsWith("//", startIndex)) {
    return findLineEnd(text, startIndex);
  }
  if (text.startsWith("/*", startIndex)) {
    return findBlockCommentEnd(text, startIndex);
  }
  return undefined;
}

function removeKotlinComments(text) {
  let result = "";
  let index = 0;

  while (index < text.length) {
    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd;
      continue;
    }

    if (text.startsWith("\"\"\"", index)) {
      const closeIndex = text.indexOf("\"\"\"", index + 3);
      const end = closeIndex === -1 ? text.length : closeIndex + 3;
      result += text.slice(index, end);
      index = end;
      continue;
    }
    if (text[index] === "\"" || text[index] === "'") {
      const end = findQuotedEnd(text, index, text[index]);
      result += text.slice(index, end);
      index = end;
      continue;
    }

    result += text[index];
    index += 1;
  }

  return result;
}

function collectIgnoredKotlinRanges(text) {
  const ranges = [];
  let index = 0;

  while (index < text.length) {
    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      const end = commentEnd;
      ranges.push({ end, start: index });
      index = end;
      continue;
    }
    if (text.startsWith("\"\"\"", index)) {
      const closeIndex = text.indexOf("\"\"\"", index + 3);
      const end = closeIndex === -1 ? text.length : closeIndex + 3;
      ranges.push({ end, start: index });
      index = end;
      continue;
    }
    if (text[index] === "\"" || text[index] === "'") {
      const end = findQuotedEnd(text, index, text[index]);
      ranges.push({ end, start: index });
      index = end;
      continue;
    }
    index += 1;
  }

  return ranges;
}

function isInIgnoredRange(offset, ranges) {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevel(text, separator) {
  const parts = [];
  let start = 0;
  let angleDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let quote;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (quote === "\"\"\"" && text.startsWith("\"\"\"", index)) {
        quote = undefined;
        index += 2;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (text.startsWith("\"\"\"", index)) {
      quote = "\"\"\"";
      index += 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (
      char === separator
      && angleDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
      && parenDepth === 0
    ) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

function findTopLevelChar(text, target) {
  let angleDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let quote;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (quote === "\"\"\"" && text.startsWith("\"\"\"", index)) {
        quote = undefined;
        index += 2;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (text.startsWith("\"\"\"", index)) {
      quote = "\"\"\"";
      index += 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (
      char === target
      && angleDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
      && parenDepth === 0
    ) {
      return index;
    }
  }

  return -1;
}

function isKotlinIdentifierPath(value) {
  return /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(value);
}

function parseKotlinCharLiteralExpression(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("'")) {
    return undefined;
  }

  let character;
  let closeIndex;
  if (trimmed[1] === "\\") {
    const escaped = parseEscapedStringCharacter(trimmed, 1);
    if (escaped === undefined) {
      return undefined;
    }
    character = escaped.character === "\u0000" ? "$" : escaped.character;
    closeIndex = escaped.nextIndex + 1;
  } else {
    character = trimmed[1];
    closeIndex = 2;
  }

  if (character === undefined || trimmed[closeIndex] !== "'") {
    return undefined;
  }
  if (trimmed.slice(closeIndex + 1).trim() !== "") {
    return undefined;
  }
  return character;
}

function parseKotlinIntegerLiteralExpression(value) {
  const trimmed = value.trim();
  const match = /^([+-]?)(0|[1-9][0-9_]*|0[xX][0-9A-Fa-f_]+|0[bB][01_]+)(L)?$/.exec(trimmed);
  if (!match) {
    return undefined;
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const unsigned = match[2].replace(/_/g, "");
  let parsed;
  if (/^0[xX]/.test(unsigned)) {
    parsed = BigInt(`0x${unsigned.slice(2)}`);
  } else if (/^0[bB]/.test(unsigned)) {
    parsed = BigInt(`0b${unsigned.slice(2)}`);
  } else {
    parsed = BigInt(unsigned);
  }
  return String(sign * parsed);
}

function parseKotlinBooleanLiteralExpression(value) {
  const trimmed = value.trim();
  return trimmed === "true" || trimmed === "false" ? trimmed : undefined;
}

function appendStringTemplateValue(result, name, constants) {
  if (!isKotlinIdentifierPath(name) || !constants.has(name)) {
    return undefined;
  }
  return `${result}${constants.get(name)}`;
}

function interpolateStringTemplate(value, constants) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "$") {
      result += char;
      continue;
    }

    if (value[index + 1] === "{") {
      const closeIndex = value.indexOf("}", index + 2);
      if (closeIndex === -1) {
        return undefined;
      }
      const expression = value.slice(index + 2, closeIndex).trim();
      const charValue = parseKotlinCharLiteralExpression(expression);
      if (charValue !== undefined) {
        result += charValue;
        index = closeIndex;
        continue;
      }
      const nextResult = appendStringTemplateValue(
        result,
        expression,
        constants,
      );
      if (nextResult === undefined) {
        return undefined;
      }
      result = nextResult;
      index = closeIndex;
      continue;
    }

    const match = /^[A-Za-z_]\w*/.exec(value.slice(index + 1));
    if (!match) {
      result += char;
      continue;
    }
    const nextResult = appendStringTemplateValue(result, match[0], constants);
    if (nextResult === undefined) {
      return undefined;
    }
    result = nextResult;
    index += match[0].length;
  }
  return result;
}

function parseEscapedStringCharacter(text, slashIndex) {
  const escaped = text[slashIndex + 1];
  if (escaped === undefined) {
    return undefined;
  }
  if (escaped === "u") {
    const hex = text.slice(slashIndex + 2, slashIndex + 6);
    if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
      return {
        character: String.fromCharCode(Number.parseInt(hex, 16)),
        nextIndex: slashIndex + 5,
      };
    }
  }

  const escapedCharacters = new Map([
    ["b", "\b"],
    ["n", "\n"],
    ["r", "\r"],
    ["t", "\t"],
    ["\"", "\""],
    ["'", "'"],
    ["\\", "\\"],
    ["$", "\u0000"],
  ]);

  return {
    character: escapedCharacters.has(escaped) ? escapedCharacters.get(escaped) : escaped,
    nextIndex: slashIndex + 1,
  };
}

function parseStringLiteralTerm(text, constants) {
  const trimmed = text.trim();
  if (trimmed.startsWith("\"\"\"")) {
    const end = trimmed.indexOf("\"\"\"", 3);
    if (end !== -1 && trimmed.slice(end + 3).trim() === "") {
      return interpolateStringTemplate(trimmed.slice(3, end), constants);
    }
    return undefined;
  }
  if (!trimmed.startsWith("\"")) {
    return undefined;
  }

  let value = "";
  for (let index = 1; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\") {
      const escaped = parseEscapedStringCharacter(trimmed, index);
      if (escaped !== undefined) {
        value += escaped.character;
        index = escaped.nextIndex;
        continue;
      }
      return undefined;
    }
    if (char === "\"") {
      if (trimmed.slice(index + 1).trim() !== "") {
        return undefined;
      }
      const templateValue = interpolateStringTemplate(value, constants);
      return templateValue === undefined ? undefined : templateValue.replace(/\u0000/g, "$");
    }
    value += char;
  }
  return undefined;
}

function evaluateStringExpression(expression, constants) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateStringExpression(trimmed.slice(1, -1), constants);
  }
  if (isKotlinIdentifierPath(trimmed) && constants.has(trimmed)) {
    return constants.get(trimmed);
  }

  const literal = parseStringLiteralTerm(trimmed, constants);
  if (literal !== undefined) {
    return literal;
  }
  const charLiteral = parseKotlinCharLiteralExpression(trimmed);
  if (charLiteral !== undefined) {
    return charLiteral;
  }
  const intLiteral = parseKotlinIntegerLiteralExpression(trimmed);
  if (intLiteral !== undefined) {
    return intLiteral;
  }
  const booleanLiteral = parseKotlinBooleanLiteralExpression(trimmed);
  if (booleanLiteral !== undefined) {
    return booleanLiteral;
  }

  const parts = splitTopLevel(trimmed, "+").map((part) => part.trim());
  if (parts.length > 1) {
    const values = parts.map((part) => evaluateStringExpression(part, constants));
    if (values.every((value) => value !== undefined)) {
      return values.join("");
    }
  }

  return undefined;
}

function expressionInsideCall(expression, callName) {
  const trimmed = expression.trim();
  if (!trimmed.startsWith(`${callName}(`)) {
    return undefined;
  }
  const openParen = trimmed.indexOf("(");
  const closeParen = findMatchingParen(trimmed, openParen);
  if (closeParen !== trimmed.length - 1) {
    return undefined;
  }
  return trimmed.slice(openParen + 1, closeParen);
}

function evaluateStepAliasExpression(expression, constants) {
  const trimmed = expression.trim();
  const arrayCall = expressionInsideCall(trimmed, "arrayOf");
  if (arrayCall !== undefined) {
    return splitTopLevelParameters(arrayCall)
      .map((part) => evaluateStringExpression(part, constants))
      .filter((value) => value !== undefined);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return splitTopLevelParameters(trimmed.slice(1, -1))
      .map((part) => evaluateStringExpression(part, constants))
      .filter((value) => value !== undefined);
  }

  const value = evaluateStringExpression(trimmed, constants);
  return value === undefined ? [] : [value];
}

function findConstExpressionEnd(text, startIndex) {
  let angleDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let quote;
  let hasExpression = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (quote === "\"\"\"" && text.startsWith("\"\"\"", index)) {
        quote = undefined;
        index += 2;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (text.startsWith("\"\"\"", index)) {
      quote = "\"\"\"";
      hasExpression = true;
      index += 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      hasExpression = true;
      continue;
    }
    if ((char === "\r" || char === "\n") && hasExpression) {
      if (
        angleDepth === 0
        && bracketDepth === 0
        && braceDepth === 0
        && parenDepth === 0
        && !text.slice(startIndex, index).trimEnd().endsWith("+")
      ) {
        return index;
      }
    }
    if (
      (char === ";" || char === "}")
      && hasExpression
      && angleDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
      && parenDepth === 0
    ) {
      return index;
    }
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    }
    if (!/\s/.test(char)) {
      hasExpression = true;
    }
  }

  return text.length;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (quote === "\"\"\"" && text.startsWith("\"\"\"", index)) {
        quote = undefined;
        index += 2;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (text.startsWith("\"\"\"", index)) {
      quote = "\"\"\"";
      index += 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findObjectBodyStart(text, startIndex) {
  let angleDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (quote === "\"\"\"" && text.startsWith("\"\"\"", index)) {
        quote = undefined;
        index += 2;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (text.startsWith("\"\"\"", index)) {
      quote = "\"\"\"";
      index += 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (
      char === "{"
      && angleDepth === 0
      && bracketDepth === 0
      && parenDepth === 0
    ) {
      return index;
    }
  }

  return -1;
}

function collectObjectRanges(text, ignoredRanges) {
  const ranges = [];
  const objectPattern = /\bobject\s+([A-Za-z_]\w*)\b/g;
  let match = objectPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = objectPattern.exec(text);
      continue;
    }

    const bodyStart = findObjectBodyStart(text, objectPattern.lastIndex);
    if (bodyStart !== -1) {
      const bodyEnd = findMatchingBrace(text, bodyStart);
      if (bodyEnd !== -1) {
        ranges.push({
          end: bodyEnd,
          name: match[1],
          start: bodyStart + 1,
        });
        objectPattern.lastIndex = bodyStart + 1;
      }
    }
    match = objectPattern.exec(text);
  }
  return ranges;
}

function collectClassRanges(text, ignoredRanges) {
  const ranges = [];
  const classPattern = /\bclass\s+([A-Za-z_]\w*)\b/g;
  let match = classPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = classPattern.exec(text);
      continue;
    }

    const bodyStart = findObjectBodyStart(text, classPattern.lastIndex);
    if (bodyStart !== -1) {
      const bodyEnd = findMatchingBrace(text, bodyStart);
      if (bodyEnd !== -1) {
        ranges.push({
          end: bodyEnd,
          name: match[1],
          start: bodyStart + 1,
        });
        classPattern.lastIndex = bodyStart + 1;
      }
    }
    match = classPattern.exec(text);
  }
  return ranges;
}

function collectCompanionObjectRanges(text, ignoredRanges, classRanges) {
  const ranges = [];
  const companionPattern = /\bcompanion\s+object(?:\s+[A-Za-z_]\w*)?\b/g;
  let match = companionPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = companionPattern.exec(text);
      continue;
    }

    const enclosingClassPath = enclosingObjectPath(classRanges, match.index);
    const bodyStart = findObjectBodyStart(text, companionPattern.lastIndex);
    if (enclosingClassPath.length > 0 && bodyStart !== -1) {
      const bodyEnd = findMatchingBrace(text, bodyStart);
      if (bodyEnd !== -1) {
        ranges.push({
          end: bodyEnd,
          name: enclosingClassPath.join("."),
          start: bodyStart + 1,
        });
        companionPattern.lastIndex = bodyStart + 1;
      }
    }
    match = companionPattern.exec(text);
  }
  return ranges;
}

function enclosingObjectPath(objectRanges, offset) {
  return objectRanges
    .filter((range) => offset >= range.start && offset < range.end)
    .sort((left, right) => left.start - right.start)
    .map((range) => range.name);
}

function collectStringConstants(text) {
  const constants = new Map();
  const expressions = [];
  const ignoredRanges = collectIgnoredKotlinRanges(text);
  const classRanges = collectClassRanges(text, ignoredRanges);
  const objectRanges = [
    ...collectObjectRanges(text, ignoredRanges),
    ...collectCompanionObjectRanges(text, ignoredRanges, classRanges),
  ];
  const pattern = /\bconst\s+val\s+([A-Za-z_]\w*)\s*(?::\s*(?:[A-Za-z_]\w*\.)*(?:String|Char|Int|Long|Boolean))?\s*=/g;
  let match = pattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = pattern.exec(text);
      continue;
    }

    const expressionStart = pattern.lastIndex;
    const expressionEnd = findConstExpressionEnd(text, expressionStart);
    const objectPath = enclosingObjectPath(objectRanges, match.index);
    const names = [match[1]];
    if (objectPath.length > 0) {
      names.push(`${objectPath.join(".")}.${match[1]}`);
    }
    expressions.push({
      expression: text.slice(expressionStart, expressionEnd),
      names,
    });
    pattern.lastIndex = expressionEnd;
    match = pattern.exec(text);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const { expression, names } of expressions) {
      if (names.every((name) => constants.has(name))) {
        continue;
      }
      const value = evaluateStringExpression(expression, constants);
      if (value !== undefined) {
        for (const name of names) {
          if (!constants.has(name)) {
            constants.set(name, value);
          }
        }
        changed = true;
      }
    }
  }

  return constants;
}

function extractStepAliases(annotationText, constants) {
  const args = splitTopLevelParameters(annotationText);
  const positionalExpressions = [];
  let valueExpression;

  for (const arg of args) {
    const equalsIndex = findTopLevelChar(arg, "=");
    if (equalsIndex === -1) {
      positionalExpressions.push(arg);
      continue;
    }

    const name = arg.slice(0, equalsIndex).trim();
    if (name === "value") {
      valueExpression = arg.slice(equalsIndex + 1);
      break;
    }
  }

  if (valueExpression !== undefined) {
    return evaluateStepAliasExpression(valueExpression, constants);
  }

  return positionalExpressions.flatMap((expression) => (
    evaluateStepAliasExpression(expression, constants)
  ));
}

function countStepParameters(stepText) {
  let count = 0;
  let index = 0;

  while (index < stepText.length) {
    const openIndex = stepText.indexOf("<", index);
    if (openIndex === -1) {
      break;
    }

    const closeIndex = findDynamicParameterEnd(stepText, openIndex);
    if (closeIndex === -1) {
      break;
    }

    count += 1;
    index = closeIndex + 1;
  }

  return count;
}

function findDynamicParameterEnd(text, openIndex) {
  let escaped = false;

  for (let index = openIndex + 1; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\r" || character === "\n") {
      return -1;
    }

    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === ">") {
      return index;
    }
  }

  return -1;
}

function findBlankGaugeSteps(text) {
  const entries = [];
  let line = 0;
  let lineStart = 0;

  while (lineStart <= text.length) {
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd === -1) {
      lineEnd = text.length;
    }

    const rawLine = text.slice(lineStart, lineEnd).replace(/\r$/, "");
    const marker = rawLine.search(/\S/);
    if (
      marker !== -1
      && rawLine[marker] === "*"
      && rawLine.slice(marker + 1).trim() === ""
    ) {
      entries.push({
        end: { line, character: rawLine.length },
        start: { line, character: marker },
      });
    }

    if (lineEnd === text.length) {
      break;
    }
    line += 1;
    lineStart = lineEnd + 1;
  }

  return entries;
}

function splitTopLevelParameters(text) {
  return splitTopLevel(text, ",");
}

function countKotlinParameters(parameterText) {
  const trimmed = removeKotlinComments(parameterText).trim();
  if (!trimmed) {
    return 0;
  }
  return splitTopLevelParameters(trimmed)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function findTopLevelDot(text) {
  let angleDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let dotIndex = -1;
  let quote;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    } else if (
      char === "."
      && angleDepth === 0
      && bracketDepth === 0
      && parenDepth === 0
    ) {
      dotIndex = index;
    }
  }

  return dotIndex;
}

function stripLeadingTypeParameters(header) {
  const trimmed = header.trim();
  if (!trimmed.startsWith("<")) {
    return trimmed;
  }

  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "<") {
      depth += 1;
    } else if (char === ">") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(index + 1).trim();
      }
    }
  }

  return trimmed;
}

function isKotlinFunctionName(name) {
  return /^[A-Za-z_]\w*$/.test(name) || /^`[^`\r\n]+`$/.test(name);
}

function isKotlinFunctionHeader(header) {
  const trimmed = stripLeadingTypeParameters(header);
  const dotIndex = findTopLevelDot(trimmed);
  const receiver = dotIndex === -1 ? undefined : trimmed.slice(0, dotIndex).trim();
  const name = dotIndex === -1 ? trimmed : trimmed.slice(dotIndex + 1).trim();

  return Boolean(
    isKotlinFunctionName(name)
    && (receiver === undefined || receiver.length > 0),
  );
}

function findNextFunction(text, startIndex, ignoredRanges = []) {
  const funPattern = /\bfun\b/g;
  funPattern.lastIndex = startIndex;
  let match = funPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = funPattern.exec(text);
      continue;
    }
    const openParen = text.indexOf("(", funPattern.lastIndex);
    if (openParen === -1) {
      return undefined;
    }
    const header = text.slice(funPattern.lastIndex, openParen);
    if (isKotlinFunctionHeader(header)) {
      const closeParen = findMatchingParen(text, openParen);
      if (closeParen !== -1) {
        return {
          parameterEnd: closeParen,
          parameterStart: openParen + 1,
          parameterText: text.slice(openParen + 1, closeParen),
        };
      }
    }
    match = funPattern.exec(text);
  }
  return undefined;
}

function skipWhitespaceAndComments(text, startIndex) {
  let index = startIndex;
  while (index < text.length) {
    if (/\s/.test(text[index])) {
      index += 1;
      continue;
    }
    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd;
      continue;
    }
    return index;
  }
  return index;
}

function skipKotlinAnnotation(text, startIndex) {
  if (text[startIndex] !== "@") {
    return startIndex;
  }

  let index = startIndex + 1;
  const target = /^[A-Za-z_]\w*:/.exec(text.slice(index));
  if (target) {
    index += target[0].length;
  }

  const name = /^(?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*/.exec(text.slice(index));
  if (!name) {
    return startIndex;
  }
  index += name[0].length;
  index = skipWhitespaceAndComments(text, index);
  if (text[index] === "(") {
    const closeParen = findMatchingParen(text, index);
    if (closeParen === -1) {
      return text.length;
    }
    return closeParen + 1;
  }
  return index;
}

function findAttachedFunction(text, startIndex, ignoredRanges = []) {
  let index = startIndex;
  while (index < text.length) {
    index = skipWhitespaceAndComments(text, index);
    if (text[index] === "@") {
      const next = skipKotlinAnnotation(text, index);
      if (next === index) {
        return undefined;
      }
      index = next;
      continue;
    }

    const token = /^[A-Za-z_]\w*/.exec(text.slice(index));
    if (!token) {
      return undefined;
    }
    if (token[0] === "fun") {
      return findNextFunction(text, index, ignoredRanges);
    }
    if (KOTLIN_FUNCTION_MODIFIERS.has(token[0])) {
      index += token[0].length;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function stepAnnotationImports(text) {
  const imports = new Map();
  const importPattern = /^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/gm;
  let match = importPattern.exec(text);
  while (match) {
    const importedName = match[1];
    const alias = match[2];
    const importedParts = importedName.split(".");
    const exposedName = alias || importedParts[importedParts.length - 1];
    if (importedParts[importedParts.length - 1] === "Step") {
      imports.set(exposedName, importedName);
    }
    match = importPattern.exec(text);
  }
  return imports;
}

function isStepAnnotationAllowed(annotationName, stepImports) {
  if (annotationName === GAUGE_STEP_ANNOTATION) {
    return true;
  }
  if (annotationName.includes(".")) {
    return false;
  }
  if (stepImports.has(annotationName)) {
    return stepImports.get(annotationName) === GAUGE_STEP_ANNOTATION;
  }
  return annotationName === "Step";
}

function findStepFunctions(text) {
  const entries = [];
  const annotationPattern = /@((?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*)\b/g;
  const constants = collectStringConstants(text);
  const ignoredRanges = collectIgnoredKotlinRanges(text);
  const stepImports = stepAnnotationImports(text);
  let annotationMatch = annotationPattern.exec(text);
  while (annotationMatch) {
    if (isInIgnoredRange(annotationMatch.index, ignoredRanges)) {
      annotationMatch = annotationPattern.exec(text);
      continue;
    }
    const annotationName = annotationMatch[1];
    if (!isStepAnnotationAllowed(annotationName, stepImports)) {
      annotationMatch = annotationPattern.exec(text);
      continue;
    }
    let openParen = annotationPattern.lastIndex;
    while (/\s/.test(text[openParen])) {
      openParen += 1;
    }
    if (text[openParen] !== "(") {
      annotationMatch = annotationPattern.exec(text);
      continue;
    }
    const closeParen = findMatchingParen(text, openParen);
    if (closeParen === -1) {
      annotationPattern.lastIndex = openParen + 1;
      annotationMatch = annotationPattern.exec(text);
      continue;
    }
    const aliases = extractStepAliases(text.slice(openParen + 1, closeParen), constants);
    const method = findAttachedFunction(text, closeParen + 1, ignoredRanges);
    if (aliases.length > 0 && method) {
      entries.push({ aliases, ...method });
    }
    annotationPattern.lastIndex = closeParen + 1;
    annotationMatch = annotationPattern.exec(text);
  }
  return entries;
}

function mismatchMessage(actual, expected, alias) {
  return `${PARAMETER_MISMATCH_PREFIX}(found [${actual}] expected [${expected}]) with step annotation : "${alias}". `;
}

class GaugeStepDiagnosticsProvider {
  constructor(options = {}) {
    this.vscode = getVscode(options.vscode);
    this.projectFactory = options.projectFactory;
  }

  isGaugeProjectDocument(document) {
    if (!this.projectFactory || typeof this.projectFactory.getGaugeRootFromFilePath !== "function") {
      return true;
    }
    const file = document.uri && document.uri.fsPath;
    if (!file) {
      return true;
    }
    try {
      this.projectFactory.getGaugeRootFromFilePath(file);
      return true;
    } catch (_error) {
      return false;
    }
  }

  shouldDiagnose(document) {
    return Boolean(
      document
      && (document.languageId === KOTLIN_LANGUAGE || document.languageId === GAUGE_LANGUAGE)
      && typeof document.getText === "function"
      && this.isGaugeProjectDocument(document),
    );
  }

  provideDiagnostics(document) {
    if (!this.shouldDiagnose(document)) {
      return [];
    }

    const text = document.getText();
    const diagnostics = [];
    if (document.languageId === GAUGE_LANGUAGE) {
      for (const entry of findBlankGaugeSteps(text)) {
        diagnostics.push(createDiagnostic(
          this.vscode,
          createRange(this.vscode, entry.start, entry.end),
          BLANK_STEP_MESSAGE,
        ));
      }
      return diagnostics;
    }

    for (const entry of findStepFunctions(text)) {
      const actual = countKotlinParameters(entry.parameterText);
      const start = positionAt(text, entry.parameterStart);
      const end = positionAt(text, entry.parameterEnd);
      const range = createRange(this.vscode, start, end);
      for (const alias of entry.aliases) {
        const expected = countStepParameters(alias);
        if (actual !== expected) {
          diagnostics.push(createDiagnostic(
            this.vscode,
            range,
            mismatchMessage(actual, expected, alias),
          ));
        }
      }
    }
    return diagnostics;
  }

  updateDocument(collection, document) {
    if (!document || !document.uri) {
      return;
    }
    if (!this.shouldDiagnose(document)) {
      if (typeof collection.delete === "function") {
        collection.delete(document.uri);
      }
      return;
    }
    collection.set(document.uri, this.provideDiagnostics(document));
  }

  register() {
    if (!this.vscode.languages || typeof this.vscode.languages.createDiagnosticCollection !== "function") {
      return { dispose() {} };
    }

    const collection = this.vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    const workspace = this.vscode.workspace || {};
    const disposables = [collection];
    const registerListener = (name, listener) => {
      if (typeof workspace[name] === "function") {
        const disposable = workspace[name](listener);
        if (disposable) {
          disposables.push(disposable);
        }
      }
    };

    for (const document of workspace.textDocuments || []) {
      this.updateDocument(collection, document);
    }
    registerListener("onDidOpenTextDocument", (document) => this.updateDocument(collection, document));
    registerListener("onDidChangeTextDocument", (event) => this.updateDocument(collection, event.document));
    registerListener("onDidCloseTextDocument", (document) => {
      if (document && document.uri && typeof collection.delete === "function") {
        collection.delete(document.uri);
      }
    });

    return {
      dispose() {
        for (const disposable of disposables) {
          if (disposable && typeof disposable.dispose === "function") {
            disposable.dispose();
          }
        }
      },
    };
  }
}

module.exports = {
  COLLECTION_NAME,
  GaugeStepDiagnosticsProvider,
  countKotlinParameters,
  countStepParameters,
};
