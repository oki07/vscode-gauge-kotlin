"use strict";

const COLLECTION_NAME = "gauge-kotlin";
const GAUGE_LANGUAGE = "gauge";
const KOTLIN_LANGUAGE = "kotlin";
const BLANK_STEP_MESSAGE = "Step should not be blank";
const PARAMETER_MISMATCH_PREFIX = "Parameter count mismatch";
const GAUGE_STEP_ANNOTATION = "com.thoughtworks.gauge.Step";
const GAUGE_STEP_PACKAGE = "com.thoughtworks.gauge";
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
const KOTLIN_PROPERTY_MODIFIERS = new Set([
  ...KOTLIN_FUNCTION_MODIFIERS,
  "const",
  "lateinit",
]);
const KOTLIN_ANNOTATION_USE_SITE_TARGETS = new Set([
  "all",
  "delegate",
  "field",
  "file",
  "get",
  "param",
  "property",
  "receiver",
  "set",
  "setparam",
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
      result += " ";
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

function replaceKotlinCommentsWithSpaces(text) {
  let result = "";
  let index = 0;

  while (index < text.length) {
    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      result += " ".repeat(commentEnd - index);
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

function findMatchingBracket(text, openIndex) {
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
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function isFunctionTypeArrowClose(text, index) {
  return text[index] === ">" && text[index - 1] === "-";
}

function findMatchingAngle(text, openIndex) {
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
    if (char === "`") {
      const closeIndex = text.indexOf("`", index + 1);
      if (closeIndex === -1) {
        return -1;
      }
      index = closeIndex;
    } else if (char === "<") {
      depth += 1;
    } else if (char === ">" && !isFunctionTypeArrowClose(text, index)) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function previousNonWhitespaceIndex(text, startIndex) {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (!/\s/.test(text[index])) {
      return index;
    }
  }
  return -1;
}

function nextNonWhitespaceIndex(text, startIndex) {
  for (let index = startIndex + 1; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) {
      return index;
    }
  }
  return -1;
}

function isLikelyTypeArgumentStart(text, index) {
  if (/\s/.test(text[index - 1] || "")) {
    return false;
  }
  if (findMatchingAngle(text, index) === -1) {
    return false;
  }
  const previousIndex = previousNonWhitespaceIndex(text, index);
  const nextIndex = nextNonWhitespaceIndex(text, index);
  if (previousIndex === -1 || nextIndex === -1 || text[nextIndex] === "=") {
    return false;
  }
  const previous = text[previousIndex];
  const next = text[nextIndex];
  return /[\w`\)\]]/.test(previous) && /[A-Za-z_`*]/.test(next);
}

function splitTopLevel(text, separator) {
  const parts = [];
  let start = 0;
  let angleDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let inBacktickIdentifier = false;
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
    if (char === "`") {
      inBacktickIdentifier = !inBacktickIdentifier;
      continue;
    }
    if (inBacktickIdentifier) {
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
    if (char === "<" && isLikelyTypeArgumentStart(text, index)) {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
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
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
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

const KOTLIN_IDENTIFIER_PATTERN = "(?:[A-Za-z_]\\w*|`[^`\\r\\n]+`)";
const KOTLIN_ANNOTATION_NAME_PATTERN = `${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*`;
const KOTLIN_IDENTIFIER_PATH_PATTERN = new RegExp(
  `^${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*$`,
);

function isKotlinIdentifierPath(value) {
  return KOTLIN_IDENTIFIER_PATH_PATTERN.test(value);
}

function normalizeKotlinIdentifier(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitKotlinIdentifierPath(value) {
  const segments = [];
  let index = 0;
  while (index < value.length) {
    if (value[index] === "`") {
      const end = value.indexOf("`", index + 1);
      if (end === -1) {
        return undefined;
      }
      segments.push(value.slice(index, end + 1));
      index = end + 1;
    } else {
      const match = /^[A-Za-z_]\w*/.exec(value.slice(index));
      if (!match) {
        return undefined;
      }
      segments.push(match[0]);
      index += match[0].length;
    }

    if (index === value.length) {
      return segments;
    }
    if (value[index] !== ".") {
      return undefined;
    }
    index += 1;
  }
  return segments;
}

function normalizeKotlinIdentifierPath(value) {
  const segments = splitKotlinIdentifierPath(value.trim());
  if (segments === undefined) {
    return normalizeKotlinIdentifier(value);
  }
  return segments.map((segment) => normalizeKotlinIdentifier(segment)).join(".");
}

const KOTLIN_NUMERIC_TYPES = new Set([
  "Byte",
  "Short",
  "Int",
  "Long",
  "UByte",
  "UShort",
  "UInt",
  "ULong",
  "Float",
  "Double",
]);
const KOTLIN_INTEGER_LITERAL_BODY_PATTERN = "(?:0[xX][0-9A-Fa-f_]+|0[bB][01_]+|0|[1-9][0-9_]*)";
const KOTLIN_INTEGER_LITERAL_SUFFIX_PATTERN = "(?:L|[uU](?:[lL])?)?";
const KOTLIN_CONST_TYPE_PATTERN = "(?:[A-Za-z_]\\w*\\.)*(?:String|Char|Byte|Short|Int|Long|UByte|UShort|UInt|ULong|Float|Double|Boolean)";

function canonicalKotlinTypeName(typeName) {
  if (typeName === undefined) {
    return undefined;
  }
  const parts = typeName.split(".");
  return parts[parts.length - 1];
}

function isKotlinNumericType(typeName) {
  return KOTLIN_NUMERIC_TYPES.has(canonicalKotlinTypeName(typeName));
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
  const match = new RegExp(
    `^([+-]?)(${KOTLIN_INTEGER_LITERAL_BODY_PATTERN})${KOTLIN_INTEGER_LITERAL_SUFFIX_PATTERN}$`,
  ).exec(trimmed);
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

function parseKotlinFloatingPointLiteralExpression(value) {
  const trimmed = value.trim();
  const hasFloatSuffix = /[fF]$/.test(trimmed);
  const body = hasFloatSuffix ? trimmed.slice(0, -1) : trimmed;
  const integerPattern = /^[+-]?(?:0|[1-9][0-9_]*)$/;
  const floatingPattern = /^[+-]?(?:(?:[0-9][0-9_]*\.[0-9_]*|[0-9_]*\.[0-9][0-9_]*)(?:[eE][+-]?[0-9][0-9_]*)?|[0-9][0-9_]*[eE][+-]?[0-9][0-9_]*)$/;
  if (!floatingPattern.test(body) && !(hasFloatSuffix && integerPattern.test(body))) {
    return undefined;
  }

  const parsed = Number(body.replace(/_/g, ""));
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Number.isInteger(parsed) ? `${parsed}.0` : String(parsed);
}

function parseKotlinBooleanLiteralExpression(value) {
  const trimmed = value.trim();
  return trimmed === "true" || trimmed === "false" ? trimmed : undefined;
}

function splitTopLevelToken(text, token) {
  const parts = [];
  let start = 0;
  let angleDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let inBacktickIdentifier = false;
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
    if (char === "`") {
      inBacktickIdentifier = !inBacktickIdentifier;
      continue;
    }
    if (inBacktickIdentifier) {
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
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
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
      text.startsWith(token, index)
      && angleDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
      && parenDepth === 0
    ) {
      parts.push(text.slice(start, index).trim());
      index += token.length - 1;
      start = index + 1;
    }
  }

  parts.push(text.slice(start).trim());
  return parts;
}

function evaluateIntegerEqualityExpression(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  const equalParts = splitTopLevelToken(trimmed, "==");
  if (equalParts.length === 2) {
    const left = evaluateIntegerArithmeticExpression(equalParts[0], constants, constantTypes);
    const right = evaluateIntegerArithmeticExpression(equalParts[1], constants, constantTypes);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return BigInt(left) === BigInt(right) ? "true" : "false";
  }
  if (equalParts.length > 2) {
    return undefined;
  }

  const notEqualParts = splitTopLevelToken(trimmed, "!=");
  if (notEqualParts.length === 2) {
    const left = evaluateIntegerArithmeticExpression(notEqualParts[0], constants, constantTypes);
    const right = evaluateIntegerArithmeticExpression(notEqualParts[1], constants, constantTypes);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return BigInt(left) !== BigInt(right) ? "true" : "false";
  }
  return undefined;
}

function evaluateIntegerComparisonExpression(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  const operators = [">=", "<=", ">", "<"];
  for (const operator of operators) {
    const parts = splitTopLevelToken(trimmed, operator);
    if (parts.length === 2) {
      const left = evaluateIntegerArithmeticExpression(parts[0], constants, constantTypes);
      const right = evaluateIntegerArithmeticExpression(parts[1], constants, constantTypes);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      const leftValue = BigInt(left);
      const rightValue = BigInt(right);
      if (operator === ">=") {
        return leftValue >= rightValue ? "true" : "false";
      }
      if (operator === "<=") {
        return leftValue <= rightValue ? "true" : "false";
      }
      if (operator === ">") {
        return leftValue > rightValue ? "true" : "false";
      }
      return leftValue < rightValue ? "true" : "false";
    }
    if (parts.length > 2) {
      return undefined;
    }
  }
  return undefined;
}

function splitTopLevelNumericComparisonToken(text, token) {
  const parts = [];
  let start = 0;
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
    if (char === "[") {
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
      text.startsWith(token, index)
      && bracketDepth === 0
      && braceDepth === 0
      && parenDepth === 0
    ) {
      parts.push(text.slice(start, index).trim());
      index += token.length - 1;
      start = index + 1;
    }
  }

  parts.push(text.slice(start).trim());
  return parts;
}

function compareNumericValues(left, operator, right) {
  if (!left.floating && !right.floating) {
    if (operator === "==") {
      return left.value === right.value;
    }
    if (operator === "!=") {
      return left.value !== right.value;
    }
    if (operator === ">=") {
      return left.value >= right.value;
    }
    if (operator === "<=") {
      return left.value <= right.value;
    }
    if (operator === ">") {
      return left.value > right.value;
    }
    return left.value < right.value;
  }

  const leftValue = numericValueAsNumber(left);
  const rightValue = numericValueAsNumber(right);
  if (operator === "==") {
    return leftValue === rightValue;
  }
  if (operator === "!=") {
    return leftValue !== rightValue;
  }
  if (operator === ">=") {
    return leftValue >= rightValue;
  }
  if (operator === "<=") {
    return leftValue <= rightValue;
  }
  if (operator === ">") {
    return leftValue > rightValue;
  }
  return leftValue < rightValue;
}

function evaluateNumericBooleanExpression(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  const operators = ["==", "!=", ">=", "<=", ">", "<"];
  for (const operator of operators) {
    const parts = splitTopLevelNumericComparisonToken(trimmed, operator);
    if (parts.length === 2) {
      const left = evaluateNumericArithmetic(parts[0], constants, constantTypes);
      const right = evaluateNumericArithmetic(parts[1], constants, constantTypes);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      return compareNumericValues(left, operator, right) ? "true" : "false";
    }
    if (parts.length > 2) {
      return undefined;
    }
  }
  return undefined;
}

function evaluateStringEqualityOperand(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateStringEqualityOperand(trimmed.slice(1, -1), constants, constantTypes);
  }

  const literal = parseStringLiteralTerm(trimmed, constants, constantTypes);
  if (literal !== undefined) {
    return literal;
  }
  if (
    isKotlinIdentifierPath(trimmed)
    && constants.has(trimmed)
    && canonicalKotlinTypeName(constantTypes.get(trimmed)) === "String"
  ) {
    return constants.get(trimmed);
  }
  const parts = splitTopLevel(trimmed, "+").map((part) => part.trim());
  if (parts.length > 1) {
    const values = parts.map((part) => evaluateStringExpression(part, constants, constantTypes));
    const hasStringOperand = parts.some((part) => evaluateStringEqualityOperand(part, constants, constantTypes) !== undefined);
    if (hasStringOperand && values.every((value) => value !== undefined)) {
      return values.join("");
    }
  }
  return undefined;
}

function evaluateStringEqualityExpression(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  const equalParts = splitTopLevelToken(trimmed, "==");
  if (equalParts.length === 2) {
    const left = evaluateStringEqualityOperand(equalParts[0], constants, constantTypes);
    const right = evaluateStringEqualityOperand(equalParts[1], constants, constantTypes);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return left === right ? "true" : "false";
  }
  if (equalParts.length > 2) {
    return undefined;
  }

  const notEqualParts = splitTopLevelToken(trimmed, "!=");
  if (notEqualParts.length === 2) {
    const left = evaluateStringEqualityOperand(notEqualParts[0], constants, constantTypes);
    const right = evaluateStringEqualityOperand(notEqualParts[1], constants, constantTypes);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return left !== right ? "true" : "false";
  }
  return undefined;
}

function evaluateBooleanEqualityOperand(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateBooleanEqualityOperand(trimmed.slice(1, -1), constants, constantTypes);
  }

  const literal = parseKotlinBooleanLiteralExpression(trimmed);
  if (literal !== undefined) {
    return literal;
  }
  if (
    isKotlinIdentifierPath(trimmed)
    && constants.has(trimmed)
    && canonicalKotlinTypeName(constantTypes.get(trimmed)) === "Boolean"
  ) {
    return parseKotlinBooleanLiteralExpression(constants.get(trimmed));
  }
  const evaluatedExpression = evaluateBooleanExpression(trimmed, constants, constantTypes);
  if (evaluatedExpression !== undefined) {
    return evaluatedExpression;
  }
  return undefined;
}

function evaluateBooleanEqualityExpression(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  const equalParts = splitTopLevelToken(trimmed, "==");
  if (equalParts.length === 2) {
    const left = evaluateBooleanEqualityOperand(equalParts[0], constants, constantTypes);
    const right = evaluateBooleanEqualityOperand(equalParts[1], constants, constantTypes);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return left === right ? "true" : "false";
  }
  if (equalParts.length > 2) {
    return undefined;
  }

  const notEqualParts = splitTopLevelToken(trimmed, "!=");
  if (notEqualParts.length === 2) {
    const left = evaluateBooleanEqualityOperand(notEqualParts[0], constants, constantTypes);
    const right = evaluateBooleanEqualityOperand(notEqualParts[1], constants, constantTypes);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return left !== right ? "true" : "false";
  }
  return undefined;
}

function evaluateCharEqualityOperand(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateCharEqualityOperand(trimmed.slice(1, -1), constants, constantTypes);
  }

  const literal = parseKotlinCharLiteralExpression(trimmed);
  if (literal !== undefined) {
    return literal;
  }
  if (
    isKotlinIdentifierPath(trimmed)
    && constants.has(trimmed)
    && canonicalKotlinTypeName(constantTypes.get(trimmed)) === "Char"
  ) {
    return constants.get(trimmed);
  }
  return undefined;
}

function evaluateCharEqualityExpression(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  const equalParts = splitTopLevelToken(trimmed, "==");
  if (equalParts.length === 2) {
    const left = evaluateCharEqualityOperand(equalParts[0], constants, constantTypes);
    const right = evaluateCharEqualityOperand(equalParts[1], constants, constantTypes);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return left === right ? "true" : "false";
  }
  if (equalParts.length > 2) {
    return undefined;
  }

  const notEqualParts = splitTopLevelToken(trimmed, "!=");
  if (notEqualParts.length === 2) {
    const left = evaluateCharEqualityOperand(notEqualParts[0], constants, constantTypes);
    const right = evaluateCharEqualityOperand(notEqualParts[1], constants, constantTypes);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return left !== right ? "true" : "false";
  }
  return undefined;
}

function evaluateBooleanExpression(expression, constants, constantTypes = new Map()) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateBooleanExpression(trimmed.slice(1, -1), constants, constantTypes);
  }

  const disjunctionParts = splitTopLevelToken(trimmed, "||");
  if (disjunctionParts.length > 1) {
    const values = disjunctionParts.map((part) => evaluateBooleanExpression(part, constants, constantTypes));
    if (values.some((value) => value === undefined)) {
      return undefined;
    }
    return values.includes("true") ? "true" : "false";
  }
  const conjunctionParts = splitTopLevelToken(trimmed, "&&");
  if (conjunctionParts.length > 1) {
    const values = conjunctionParts.map((part) => evaluateBooleanExpression(part, constants, constantTypes));
    if (values.some((value) => value === undefined)) {
      return undefined;
    }
    return values.every((value) => value === "true") ? "true" : "false";
  }

  const integerEquality = evaluateIntegerEqualityExpression(trimmed, constants, constantTypes);
  if (integerEquality !== undefined) {
    return integerEquality;
  }
  const integerComparison = evaluateIntegerComparisonExpression(trimmed, constants, constantTypes);
  if (integerComparison !== undefined) {
    return integerComparison;
  }
  const numericBoolean = evaluateNumericBooleanExpression(trimmed, constants, constantTypes);
  if (numericBoolean !== undefined) {
    return numericBoolean;
  }
  const stringEquality = evaluateStringEqualityExpression(trimmed, constants, constantTypes);
  if (stringEquality !== undefined) {
    return stringEquality;
  }
  const booleanEquality = evaluateBooleanEqualityExpression(trimmed, constants, constantTypes);
  if (booleanEquality !== undefined) {
    return booleanEquality;
  }
  const charEquality = evaluateCharEqualityExpression(trimmed, constants, constantTypes);
  if (charEquality !== undefined) {
    return charEquality;
  }

  const literal = parseKotlinBooleanLiteralExpression(trimmed);
  if (literal !== undefined) {
    return literal;
  }
  if (isKotlinIdentifierPath(trimmed) && constants.has(trimmed)) {
    return parseKotlinBooleanLiteralExpression(constants.get(trimmed));
  }
  if (trimmed.startsWith("!")) {
    const value = evaluateBooleanExpression(trimmed.slice(1), constants, constantTypes);
    if (value !== undefined) {
      return value === "true" ? "false" : "true";
    }
  }
  return undefined;
}

function evaluateIntegerAdditionExpression(parts) {
  const values = parts.map((part) => parseKotlinIntegerLiteralExpression(part));
  if (values.some((value) => value === undefined)) {
    return undefined;
  }
  return String(values.reduce((sum, value) => sum + BigInt(value), 0n));
}

function evaluateIntegerSubtractionExpression(expression) {
  const integerLiteral = `[+-]?${KOTLIN_INTEGER_LITERAL_BODY_PATTERN}${KOTLIN_INTEGER_LITERAL_SUFFIX_PATTERN}`;
  const match = new RegExp(`^(${integerLiteral})\\s+-\\s+(${integerLiteral})$`).exec(expression);
  if (!match) {
    return undefined;
  }
  const left = parseKotlinIntegerLiteralExpression(match[1]);
  const right = parseKotlinIntegerLiteralExpression(match[2]);
  if (left === undefined || right === undefined) {
    return undefined;
  }
  return String(BigInt(left) - BigInt(right));
}

function evaluateIntegerMultiplicationExpression(parts) {
  const values = parts.map((part) => parseKotlinIntegerLiteralExpression(part));
  if (values.some((value) => value === undefined)) {
    return undefined;
  }
  return String(values.reduce((product, value) => product * BigInt(value), 1n));
}

function evaluateIntegerDivisionExpression(parts) {
  const values = parts.map((part) => parseKotlinIntegerLiteralExpression(part));
  if (values.some((value) => value === undefined)) {
    return undefined;
  }
  const [first, ...rest] = values.map((value) => BigInt(value));
  if (rest.some((value) => value === 0n)) {
    return undefined;
  }
  return String(rest.reduce((quotient, value) => quotient / value, first));
}

function evaluateIntegerRemainderExpression(parts) {
  const values = parts.map((part) => parseKotlinIntegerLiteralExpression(part));
  if (values.some((value) => value === undefined)) {
    return undefined;
  }
  const [first, ...rest] = values.map((value) => BigInt(value));
  if (rest.some((value) => value === 0n)) {
    return undefined;
  }
  return String(rest.reduce((remainder, value) => remainder % value, first));
}

function previousNonWhitespace(text, index) {
  for (let current = index - 1; current >= 0; current -= 1) {
    if (!/\s/.test(text[current])) {
      return text[current];
    }
  }
  return undefined;
}

function isUnaryAdditiveOperator(text, index) {
  const previous = previousNonWhitespace(text, index);
  return previous === undefined || "+-*/%(".includes(previous);
}

function splitTopLevelOperators(text, operators) {
  const parts = [];
  let start = 0;
  let operator;
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
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
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
      operators.has(char)
      && angleDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
      && parenDepth === 0
      && !((char === "+" || char === "-") && isUnaryAdditiveOperator(text, index))
    ) {
      parts.push({ operator, expression: text.slice(start, index).trim() });
      operator = char;
      start = index + 1;
    }
  }

  parts.push({ operator, expression: text.slice(start).trim() });
  return parts;
}

function evaluateIntegerArithmeticExpression(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateIntegerArithmeticExpression(trimmed.slice(1, -1), constants, constantTypes);
  }

  const literal = parseKotlinIntegerLiteralExpression(trimmed);
  if (literal !== undefined) {
    return literal;
  }
  if ((trimmed.startsWith("+") || trimmed.startsWith("-")) && trimmed.length > 1) {
    const unaryValue = evaluateIntegerArithmeticExpression(trimmed.slice(1), constants, constantTypes);
    if (unaryValue !== undefined) {
      return trimmed[0] === "-" ? String(-BigInt(unaryValue)) : unaryValue;
    }
  }
  if (isKotlinIdentifierPath(trimmed) && constants.has(trimmed)) {
    const typeName = canonicalKotlinTypeName(constantTypes && constantTypes.get(trimmed));
    if (typeName !== undefined && !isKotlinNumericType(typeName)) {
      return undefined;
    }
    return parseKotlinIntegerLiteralExpression(constants.get(trimmed));
  }

  const additiveParts = splitTopLevelOperators(trimmed, new Set(["+", "-"]));
  if (additiveParts.length > 1) {
    let result = evaluateIntegerArithmeticExpression(additiveParts[0].expression, constants, constantTypes);
    if (result === undefined) {
      return undefined;
    }
    for (const part of additiveParts.slice(1)) {
      const value = evaluateIntegerArithmeticExpression(part.expression, constants, constantTypes);
      if (value === undefined) {
        return undefined;
      }
      result = String(part.operator === "+" ? BigInt(result) + BigInt(value) : BigInt(result) - BigInt(value));
    }
    return result;
  }

  const multiplicativeParts = splitTopLevelOperators(trimmed, new Set(["*", "/", "%"]));
  if (multiplicativeParts.length > 1) {
    let result = evaluateIntegerArithmeticExpression(multiplicativeParts[0].expression, constants, constantTypes);
    if (result === undefined) {
      return undefined;
    }
    for (const part of multiplicativeParts.slice(1)) {
      const value = evaluateIntegerArithmeticExpression(part.expression, constants, constantTypes);
      if (value === undefined || ((part.operator === "/" || part.operator === "%") && BigInt(value) === 0n)) {
        return undefined;
      }
      if (part.operator === "*") {
        result = String(BigInt(result) * BigInt(value));
      } else if (part.operator === "/") {
        result = String(BigInt(result) / BigInt(value));
      } else {
        result = String(BigInt(result) % BigInt(value));
      }
    }
    return result;
  }

  return undefined;
}

function parseKotlinNumericLiteralExpression(value) {
  const floatingPointLiteral = parseKotlinFloatingPointLiteralExpression(value);
  if (floatingPointLiteral !== undefined) {
    return { floating: true, value: Number(floatingPointLiteral) };
  }
  const integerLiteral = parseKotlinIntegerLiteralExpression(value);
  if (integerLiteral !== undefined) {
    return { floating: false, value: BigInt(integerLiteral) };
  }
  return undefined;
}

function numericValueAsNumber(value) {
  return value.floating ? value.value : Number(value.value);
}

function formatKotlinFloatingPointValue(value) {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function applyNumericArithmeticOperator(left, operator, right) {
  const floating = left.floating || right.floating;
  if (floating) {
    const leftValue = numericValueAsNumber(left);
    const rightValue = numericValueAsNumber(right);
    if ((operator === "/" || operator === "%") && rightValue === 0) {
      return undefined;
    }
    if (operator === "+") {
      return { floating: true, value: leftValue + rightValue };
    }
    if (operator === "-") {
      return { floating: true, value: leftValue - rightValue };
    }
    if (operator === "*") {
      return { floating: true, value: leftValue * rightValue };
    }
    if (operator === "/") {
      return { floating: true, value: leftValue / rightValue };
    }
    return { floating: true, value: leftValue % rightValue };
  }

  if ((operator === "/" || operator === "%") && right.value === 0n) {
    return undefined;
  }
  if (operator === "+") {
    return { floating: false, value: left.value + right.value };
  }
  if (operator === "-") {
    return { floating: false, value: left.value - right.value };
  }
  if (operator === "*") {
    return { floating: false, value: left.value * right.value };
  }
  if (operator === "/") {
    return { floating: false, value: left.value / right.value };
  }
  return { floating: false, value: left.value % right.value };
}

function evaluateNumericArithmetic(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateNumericArithmetic(trimmed.slice(1, -1), constants, constantTypes);
  }

  const literal = parseKotlinNumericLiteralExpression(trimmed);
  if (literal !== undefined) {
    return literal;
  }
  if ((trimmed.startsWith("+") || trimmed.startsWith("-")) && trimmed.length > 1) {
    const unaryValue = evaluateNumericArithmetic(trimmed.slice(1), constants, constantTypes);
    if (unaryValue !== undefined) {
      if (unaryValue.floating) {
        return {
          floating: true,
          value: trimmed[0] === "-" ? -unaryValue.value : unaryValue.value,
        };
      }
      return {
        floating: false,
        value: trimmed[0] === "-" ? -unaryValue.value : unaryValue.value,
      };
    }
  }
  if (
    constants !== undefined
    && constantTypes !== undefined
    && isKotlinIdentifierPath(trimmed)
    && constants.has(trimmed)
    && isKotlinNumericType(constantTypes.get(trimmed))
  ) {
    return parseKotlinNumericLiteralExpression(constants.get(trimmed));
  }

  const additiveParts = splitTopLevelOperators(trimmed, new Set(["+", "-"]));
  if (additiveParts.length > 1) {
    let result = evaluateNumericArithmetic(additiveParts[0].expression, constants, constantTypes);
    if (result === undefined) {
      return undefined;
    }
    for (const part of additiveParts.slice(1)) {
      const value = evaluateNumericArithmetic(part.expression, constants, constantTypes);
      if (value === undefined) {
        return undefined;
      }
      result = applyNumericArithmeticOperator(result, part.operator, value);
      if (result === undefined) {
        return undefined;
      }
    }
    return result;
  }

  const multiplicativeParts = splitTopLevelOperators(trimmed, new Set(["*", "/", "%"]));
  if (multiplicativeParts.length > 1) {
    let result = evaluateNumericArithmetic(multiplicativeParts[0].expression, constants, constantTypes);
    if (result === undefined) {
      return undefined;
    }
    for (const part of multiplicativeParts.slice(1)) {
      const value = evaluateNumericArithmetic(part.expression, constants, constantTypes);
      if (value === undefined) {
        return undefined;
      }
      result = applyNumericArithmeticOperator(result, part.operator, value);
      if (result === undefined) {
        return undefined;
      }
    }
    return result;
  }

  return undefined;
}

function evaluateFloatingPointArithmeticExpression(expression, constants, constantTypes) {
  const value = evaluateNumericArithmetic(expression, constants, constantTypes);
  if (value === undefined || !value.floating) {
    return undefined;
  }
  return formatKotlinFloatingPointValue(value.value);
}

function appendStringTemplateValue(result, name, constants) {
  if (!isKotlinIdentifierPath(name) || !constants.has(name)) {
    return undefined;
  }
  return `${result}${constants.get(name)}`;
}

function interpolateStringTemplate(value, constants, constantTypes) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "$") {
      result += char;
      continue;
    }

    if (value[index + 1] === "{") {
      const closeIndex = findMatchingBrace(value, index + 1);
      if (closeIndex === -1) {
        return undefined;
      }
      const expression = value.slice(index + 2, closeIndex).trim();
      const expressionValue = evaluateStringExpression(expression, constants, constantTypes);
      if (expressionValue === undefined) {
        return undefined;
      }
      result += expressionValue;
      index = closeIndex;
      continue;
    }

    const match = new RegExp(`^${KOTLIN_IDENTIFIER_PATTERN}`).exec(value.slice(index + 1));
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

function parseStringLiteralTerm(text, constants, constantTypes) {
  const trimmed = text.trim();
  if (trimmed.startsWith("\"\"\"")) {
    const end = trimmed.indexOf("\"\"\"", 3);
    if (end !== -1 && trimmed.slice(end + 3).trim() === "") {
      return interpolateStringTemplate(trimmed.slice(3, end), constants, constantTypes);
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
    if (char === "$" && trimmed[index + 1] === "{") {
      const closeIndex = findMatchingBrace(trimmed, index + 1);
      if (closeIndex === -1) {
        return undefined;
      }
      value += trimmed.slice(index, closeIndex + 1);
      index = closeIndex;
      continue;
    }
    if (char === "\"") {
      if (trimmed.slice(index + 1).trim() !== "") {
        return undefined;
      }
      const templateValue = interpolateStringTemplate(value, constants, constantTypes);
      return templateValue === undefined ? undefined : templateValue.replace(/\u0000/g, "$");
    }
    value += char;
  }
  return undefined;
}

function evaluateStringExpression(expression, constants, constantTypes = new Map()) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateStringExpression(trimmed.slice(1, -1), constants, constantTypes);
  }
  if (isKotlinIdentifierPath(trimmed) && constants.has(trimmed)) {
    return constants.get(trimmed);
  }

  const literal = parseStringLiteralTerm(trimmed, constants, constantTypes);
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
  const floatingPointLiteral = parseKotlinFloatingPointLiteralExpression(trimmed);
  if (floatingPointLiteral !== undefined) {
    return floatingPointLiteral;
  }
  const booleanLiteral = parseKotlinBooleanLiteralExpression(trimmed);
  if (booleanLiteral !== undefined) {
    return booleanLiteral;
  }
  const booleanExpression = evaluateBooleanExpression(trimmed, constants, constantTypes);
  if (booleanExpression !== undefined) {
    return booleanExpression;
  }
  const integerArithmetic = evaluateIntegerArithmeticExpression(trimmed, constants, constantTypes);
  if (integerArithmetic !== undefined) {
    return integerArithmetic;
  }
  const floatingPointArithmetic = evaluateFloatingPointArithmeticExpression(trimmed, constants, constantTypes);
  if (floatingPointArithmetic !== undefined) {
    return floatingPointArithmetic;
  }
  const integerSubtraction = evaluateIntegerSubtractionExpression(trimmed);
  if (integerSubtraction !== undefined) {
    return integerSubtraction;
  }
  const productParts = splitTopLevel(trimmed, "*").map((part) => part.trim());
  if (productParts.length > 1) {
    const integerMultiplication = evaluateIntegerMultiplicationExpression(productParts);
    if (integerMultiplication !== undefined) {
      return integerMultiplication;
    }
  }
  const quotientParts = splitTopLevel(trimmed, "/").map((part) => part.trim());
  if (quotientParts.length > 1) {
    const integerDivision = evaluateIntegerDivisionExpression(quotientParts);
    if (integerDivision !== undefined) {
      return integerDivision;
    }
  }
  const remainderParts = splitTopLevel(trimmed, "%").map((part) => part.trim());
  if (remainderParts.length > 1) {
    const integerRemainder = evaluateIntegerRemainderExpression(remainderParts);
    if (integerRemainder !== undefined) {
      return integerRemainder;
    }
  }

  const parts = splitTopLevel(trimmed, "+").map((part) => part.trim());
  if (parts.length > 1) {
    const integerAddition = evaluateIntegerAdditionExpression(parts);
    if (integerAddition !== undefined) {
      return integerAddition;
    }
    const values = parts.map((part) => evaluateStringExpression(part, constants, constantTypes));
    if (values.every((value) => value !== undefined)) {
      return values.join("");
    }
  }

  return undefined;
}

function inferKotlinConstantType(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return inferKotlinConstantType(trimmed.slice(1, -1), constants, constantTypes);
  }
  if (isKotlinIdentifierPath(trimmed) && constants.has(trimmed)) {
    return canonicalKotlinTypeName(constantTypes.get(trimmed));
  }
  if (parseStringLiteralTerm(trimmed, constants, constantTypes) !== undefined) {
    return "String";
  }
  if (parseKotlinCharLiteralExpression(trimmed) !== undefined) {
    return "Char";
  }
  if (parseKotlinBooleanLiteralExpression(trimmed) !== undefined) {
    return "Boolean";
  }

  const numericLiteral = parseKotlinNumericLiteralExpression(trimmed);
  if (numericLiteral !== undefined) {
    return numericLiteral.floating ? "Double" : "Int";
  }
  const numericArithmetic = evaluateNumericArithmetic(trimmed, constants, constantTypes);
  if (numericArithmetic !== undefined) {
    return numericArithmetic.floating ? "Double" : "Int";
  }

  return undefined;
}

function expressionInsideCall(expression, callName) {
  const trimmed = expression.trim();
  let callNameEnd = callName.length;
  if (!trimmed.startsWith(callName)) {
    const kotlinCallName = `kotlin.${callName}`;
    if (!trimmed.startsWith(kotlinCallName)) {
      return undefined;
    }
    callNameEnd = kotlinCallName.length;
  }
  let openParen = skipWhitespaceAndComments(trimmed, callNameEnd);
  if (trimmed[openParen] === "<") {
    const closeAngle = findMatchingAngle(trimmed, openParen);
    if (closeAngle === -1) {
      return undefined;
    }
    openParen = skipWhitespaceAndComments(trimmed, closeAngle + 1);
  }
  if (trimmed[openParen] !== "(") {
    return undefined;
  }
  const closeParen = findMatchingParen(trimmed, openParen);
  if (closeParen !== trimmed.length - 1) {
    return undefined;
  }
  return trimmed.slice(openParen + 1, closeParen);
}

function evaluateStepAliasExpression(expression, constants, constantTypes) {
  const trimmed = expression.trim();
  const arrayCall = expressionInsideCall(trimmed, "arrayOf");
  if (arrayCall !== undefined) {
    return splitTopLevelParameters(arrayCall)
      .map((part) => evaluateStringExpression(part, constants, constantTypes))
      .filter((value) => value !== undefined);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return splitTopLevelParameters(trimmed.slice(1, -1))
      .map((part) => evaluateStringExpression(part, constants, constantTypes))
      .filter((value) => value !== undefined);
  }

  const value = evaluateStringExpression(trimmed, constants, constantTypes);
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
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
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
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
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
  const objectPattern = new RegExp(`\\bobject\\s+(${KOTLIN_IDENTIFIER_PATTERN})`, "g");
  let match = objectPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges) || isCompanionObjectKeyword(text, match.index)) {
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

function isCompanionObjectKeyword(text, objectIndex) {
  return /\bcompanion$/.test(text.slice(0, objectIndex).trimEnd());
}

function collectNamedTypeRanges(text, ignoredRanges) {
  const ranges = [];
  const typePattern = new RegExp(`\\b(?:class|interface)\\s+(${KOTLIN_IDENTIFIER_PATTERN})`, "g");
  let match = typePattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = typePattern.exec(text);
      continue;
    }

    const bodyStart = findObjectBodyStart(text, typePattern.lastIndex);
    if (bodyStart !== -1) {
      const bodyEnd = findMatchingBrace(text, bodyStart);
      if (bodyEnd !== -1) {
        ranges.push({
          end: bodyEnd,
          name: match[1],
          start: bodyStart + 1,
        });
        typePattern.lastIndex = bodyStart + 1;
      }
    }
    match = typePattern.exec(text);
  }
  return ranges;
}

function collectCompanionObjectRanges(text, ignoredRanges, classRanges) {
  const ranges = [];
  const companionPattern = new RegExp(
    `\\bcompanion\\s+object(?:\\s+(${KOTLIN_IDENTIFIER_PATTERN}))?`,
    "g",
  );
  let match = companionPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = companionPattern.exec(text);
      continue;
    }

    const enclosingClassPath = enclosingObjectPaths(classRanges, match.index)[0] || [];
    const bodyStart = findObjectBodyStart(text, companionPattern.lastIndex);
    if (enclosingClassPath.length > 0 && bodyStart !== -1) {
      const bodyEnd = findMatchingBrace(text, bodyStart);
      if (bodyEnd !== -1) {
        const enclosingName = enclosingClassPath.join(".");
        const companionName = match[1] || "Companion";
        ranges.push({
          end: bodyEnd,
          names: [
            enclosingName,
            `${enclosingName}.${companionName}`,
          ],
          start: bodyStart + 1,
        });
        companionPattern.lastIndex = bodyStart + 1;
      }
    }
    match = companionPattern.exec(text);
  }
  return ranges;
}

function rangeNames(range) {
  return Array.isArray(range.names) ? range.names : [range.name];
}

function enclosingObjectPaths(objectRanges, offset) {
  const enclosingRanges = objectRanges
    .filter((range) => offset >= range.start && offset < range.end)
    .sort((left, right) => left.start - right.start);
  let paths = [[]];
  for (const range of enclosingRanges) {
    paths = paths.flatMap((path) => rangeNames(range).map((name) => path.concat(name)));
  }
  return paths;
}

function pathText(path) {
  return path.join(".");
}

function pathHasPrefix(path, prefix) {
  const text = pathText(path);
  const prefixText = pathText(prefix);
  return text === prefixText || text.startsWith(`${prefixText}.`);
}

function readKotlinConstDeclaration(text, constIndex) {
  let index = skipWhitespaceAndComments(text, constIndex + "const".length);

  while (index < text.length) {
    if (text[index] === "@") {
      const next = skipKotlinAnnotation(text, index);
      if (next === index) {
        return undefined;
      }
      index = skipWhitespaceAndComments(text, next);
      continue;
    }

    if (isKeywordAt(text, index, "val")) {
      break;
    }

    const modifier = /^[A-Za-z_]\w*/.exec(text.slice(index));
    if (!modifier || !KOTLIN_PROPERTY_MODIFIERS.has(modifier[0])) {
      return undefined;
    }
    index = skipWhitespaceAndComments(text, index + modifier[0].length);
  }

  if (!isKeywordAt(text, index, "val")) {
    return undefined;
  }

  index = skipWhitespaceAndComments(text, index + "val".length);

  const nameMatch = new RegExp(`^${KOTLIN_IDENTIFIER_PATTERN}`).exec(text.slice(index));
  if (!nameMatch) {
    return undefined;
  }
  const name = nameMatch[0];
  index = skipWhitespaceAndComments(text, index + name.length);

  let typeName;
  if (text[index] === ":") {
    index = skipWhitespaceAndComments(text, index + 1);
    const typeMatch = new RegExp(`^${KOTLIN_CONST_TYPE_PATTERN}`).exec(text.slice(index));
    if (!typeMatch) {
      return undefined;
    }
    typeName = canonicalKotlinTypeName(typeMatch[0]);
    index = skipWhitespaceAndComments(text, index + typeMatch[0].length);
  }

  if (text[index] !== "=") {
    return undefined;
  }
  return {
    expressionStart: index + 1,
    name,
    typeName,
  };
}

function collectStringConstants(text) {
  const constants = new Map();
  const constantTypes = new Map();
  const expressions = [];
  const ignoredRanges = collectIgnoredKotlinRanges(text);
  const classRanges = collectNamedTypeRanges(text, ignoredRanges);
  const objectRanges = [
    ...collectObjectRanges(text, ignoredRanges),
    ...collectCompanionObjectRanges(text, ignoredRanges, classRanges),
  ];
  const pattern = /\bconst\b/g;
  let match = pattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = pattern.exec(text);
      continue;
    }

    const declaration = readKotlinConstDeclaration(text, match.index);
    if (declaration === undefined) {
      pattern.lastIndex = match.index + "const".length;
      match = pattern.exec(text);
      continue;
    }

    const expressionStart = declaration.expressionStart;
    const expressionEnd = findConstExpressionEnd(text, expressionStart);
    const objectPaths = enclosingObjectPaths(objectRanges, match.index);
    const classPaths = enclosingObjectPaths(classRanges, match.index);
    const names = new Set([declaration.name]);
    for (const objectPath of objectPaths) {
      if (objectPath.length > 0) {
        names.add(`${pathText(objectPath)}.${declaration.name}`);
      }
    }
    for (const classPath of classPaths) {
      if (classPath.length === 0) {
        continue;
      }
      for (const objectPath of objectPaths) {
        if (objectPath.length > 0 && !pathHasPrefix(objectPath, classPath)) {
          names.add(`${pathText(classPath.concat(objectPath))}.${declaration.name}`);
        }
      }
    }
    expressions.push({
      expression: text.slice(expressionStart, expressionEnd),
      names: [...names],
      typeName: declaration.typeName,
    });
    pattern.lastIndex = expressionEnd;
    match = pattern.exec(text);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const { expression, names, typeName } of expressions) {
      if (names.every((name) => constants.has(name))) {
        continue;
      }
      const value = evaluateStringExpression(expression, constants, constantTypes);
      if (value !== undefined) {
        const resolvedType = typeName || inferKotlinConstantType(expression, constants, constantTypes);
        for (const name of names) {
          if (!constants.has(name)) {
            constants.set(name, value);
            if (resolvedType !== undefined) {
              constantTypes.set(name, resolvedType);
            }
          }
        }
        changed = true;
      }
    }
  }

  return { constants, constantTypes };
}

function extractStepAliases(annotationText, constants, constantTypes) {
  const args = splitTopLevelParameters(annotationText);
  const positionalExpressions = [];
  let valueExpression;

  for (const arg of args) {
    const equalsIndex = findTopLevelChar(arg, "=");
    if (equalsIndex === -1) {
      positionalExpressions.push(arg);
      continue;
    }

    const name = normalizeKotlinIdentifier(removeKotlinComments(arg.slice(0, equalsIndex)));
    if (name === "value") {
      valueExpression = arg.slice(equalsIndex + 1);
      break;
    }
  }

  if (valueExpression !== undefined) {
    return evaluateStepAliasExpression(valueExpression, constants, constantTypes);
  }

  return positionalExpressions.flatMap((expression) => (
    evaluateStepAliasExpression(expression, constants, constantTypes)
  ));
}

function countStepParameters(stepText) {
  let count = 0;
  let index = 0;

  while (index < stepText.length) {
    const dynamicStart = findDynamicParameterStart(stepText, index);
    const staticStart = findStaticParameterStart(stepText, index);
    const parameter = findNextStepParameter(dynamicStart, staticStart);
    if (!parameter) {
      break;
    }

    const closeIndex = parameter.type === "dynamic"
      ? findDynamicParameterEnd(stepText, parameter.openIndex)
      : findStaticParameterEnd(stepText, parameter.openIndex);
    if (closeIndex === -1) {
      break;
    }

    count += 1;
    index = closeIndex + 1;
  }

  return count;
}

function findNextStepParameter(dynamicStart, staticStart) {
  if (dynamicStart === -1 && staticStart === -1) {
    return undefined;
  }
  if (staticStart === -1 || (dynamicStart !== -1 && dynamicStart < staticStart)) {
    return { openIndex: dynamicStart, type: "dynamic" };
  }
  return { openIndex: staticStart, type: "static" };
}

function findDynamicParameterStart(text, startIndex) {
  let openIndex = text.indexOf("<", startIndex);
  while (openIndex !== -1 && isEscapedAt(text, openIndex)) {
    openIndex = text.indexOf("<", openIndex + 1);
  }
  return openIndex;
}

function findStaticParameterStart(text, startIndex) {
  let openIndex = text.indexOf("\"", startIndex);
  while (openIndex !== -1 && isEscapedAt(text, openIndex)) {
    openIndex = text.indexOf("\"", openIndex + 1);
  }
  return openIndex;
}

function isEscapedAt(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
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

function findStaticParameterEnd(text, openIndex) {
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
    } else if (character === "\"") {
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
  let inBacktickIdentifier = false;
  let quote;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "`" && !quote) {
      inBacktickIdentifier = !inBacktickIdentifier;
      continue;
    }
    if (inBacktickIdentifier) {
      continue;
    }
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
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
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

  const closeAngle = findMatchingAngle(trimmed, 0);
  return closeAngle === -1 ? trimmed : trimmed.slice(closeAngle + 1).trim();
}

function isKotlinFunctionName(name) {
  return /^[A-Za-z_]\w*$/.test(name) || /^`[^`\r\n]+`$/.test(name);
}

function isFunctionHeaderContinuationStart(char) {
  return Boolean(
    char
    && (
      char === "("
      || char === "<"
      || char === ">"
      || char === "."
      || char === "`"
      || char === "@"
      || /[A-Za-z_]/.test(char)
    ),
  );
}

function isKotlinFunctionHeader(header) {
  const trimmed = stripLeadingTypeParameters(removeKotlinComments(header));
  const dotIndex = findTopLevelDot(trimmed);
  const receiver = dotIndex === -1 ? undefined : trimmed.slice(0, dotIndex).trim();
  const name = dotIndex === -1 ? trimmed : trimmed.slice(dotIndex + 1).trim();

  return Boolean(
    isKotlinFunctionName(name)
    && (receiver === undefined || receiver.length > 0),
  );
}

function findFunctionParameterStart(text, startIndex) {
  let inBacktickIdentifier = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    const char = text[index];
    if (char === "`") {
      inBacktickIdentifier = !inBacktickIdentifier;
      continue;
    }
    if (char === "(" && !inBacktickIdentifier) {
      return index;
    }
    if ((char === "\r" || char === "\n") && !inBacktickIdentifier) {
      const next = skipWhitespaceAndComments(text, index);
      if (isFunctionHeaderContinuationStart(text[next])) {
        index = next - 1;
        continue;
      }
      return -1;
    }
    if (char === "{" && !inBacktickIdentifier) {
      return -1;
    }
  }
  return -1;
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
    let openParen = findFunctionParameterStart(text, funPattern.lastIndex);
    while (openParen !== -1) {
      const header = text.slice(funPattern.lastIndex, openParen);
      const closeParen = findMatchingParen(text, openParen);
      if (closeParen === -1) {
        return undefined;
      }
      if (isKotlinFunctionHeader(header)) {
        return {
          parameterEnd: closeParen,
          parameterStart: openParen + 1,
          parameterText: text.slice(openParen + 1, closeParen),
        };
      }
      openParen = findFunctionParameterStart(text, closeParen + 1);
    }
    match = funPattern.exec(text);
  }
  return undefined;
}

function isPropertyAccessorStart(text, index, headerStart) {
  if (index <= headerStart || !/\s/.test(text[index - 1] || "")) {
    return false;
  }
  const token = /^(?:get|set)\b/.exec(text.slice(index));
  if (!token) {
    return false;
  }
  const next = skipWhitespaceAndComments(text, index + token[0].length);
  return text[next] === "(" || text[next] === "{";
}

function findPropertyHeaderEnd(text, startIndex) {
  let angleDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let inBacktickIdentifier = false;
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
    if (char === "`") {
      inBacktickIdentifier = !inBacktickIdentifier;
      continue;
    }
    if (inBacktickIdentifier) {
      continue;
    }

    if (angleDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      if (
        char === ":"
        || char === "="
        || char === ";"
        || char === "{"
        || char === "\n"
        || char === "\r"
        || isPropertyAccessorStart(text, index, startIndex)
      ) {
        return index;
      }
    }

    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    }
  }

  return text.length;
}

function findNextPropertyAccessor(text, startIndex, parameterText, ignoredRanges = []) {
  if (isInIgnoredRange(startIndex, ignoredRanges)) {
    return undefined;
  }
  const declaration = /^(?:val|var)\b/.exec(text.slice(startIndex));
  if (!declaration) {
    return undefined;
  }

  const headerStart = skipWhitespaceAndComments(text, startIndex + declaration[0].length);
  const headerEnd = findPropertyHeaderEnd(text, headerStart);
  const rawHeader = text.slice(headerStart, headerEnd);
  const header = removeKotlinComments(rawHeader).trim();
  const dotIndex = findTopLevelDot(header);
  const propertyName = dotIndex === -1 ? header : header.slice(dotIndex + 1).trim();
  if (!isKotlinFunctionName(propertyName)) {
    return undefined;
  }

  const nameOffset = rawHeader.lastIndexOf(propertyName);
  if (nameOffset === -1) {
    return undefined;
  }
  const nameStart = headerStart + nameOffset;
  return {
    parameterEnd: nameStart + propertyName.length,
    parameterStart: nameStart,
    parameterText,
  };
}

function findNextPropertyGetter(text, startIndex, ignoredRanges = []) {
  return findNextPropertyAccessor(text, startIndex, "", ignoredRanges);
}

function isBareAccessorBoundary(text, startIndex) {
  let index = startIndex;
  while (index < text.length) {
    if (text[index] === " " || text[index] === "\t") {
      index += 1;
      continue;
    }
    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd;
      continue;
    }
    return text[index] === "\r" || text[index] === "\n" || text[index] === ";" || text[index] === "}";
  }
  return true;
}

function findNextDirectPropertyAccessor(text, startIndex, accessorName, ignoredRanges = [], options = {}) {
  if (isInIgnoredRange(startIndex, ignoredRanges)) {
    return undefined;
  }
  const accessor = new RegExp(`^${accessorName}\\b`).exec(text.slice(startIndex));
  if (!accessor) {
    return undefined;
  }
  const openParen = skipWhitespaceAndComments(text, startIndex + accessor[0].length);
  if (text[openParen] !== "(") {
    if (
      options.implicitParameterText !== undefined
      && isBareAccessorBoundary(text, startIndex + accessor[0].length)
    ) {
      return {
        parameterEnd: startIndex + accessor[0].length,
        parameterStart: startIndex,
        parameterText: options.implicitParameterText,
      };
    }
    return undefined;
  }
  const closeParen = findMatchingParen(text, openParen);
  if (closeParen === -1) {
    return undefined;
  }
  return {
    parameterEnd: closeParen,
    parameterStart: openParen + 1,
    parameterText: text.slice(openParen + 1, closeParen),
  };
}

function findNextGetterAccessor(text, startIndex, ignoredRanges = []) {
  return findNextDirectPropertyAccessor(text, startIndex, "get", ignoredRanges, {
    implicitParameterText: "",
  });
}

function findNextSetterAccessor(text, startIndex, ignoredRanges = []) {
  return findNextDirectPropertyAccessor(text, startIndex, "set", ignoredRanges, {
    implicitParameterText: "value",
  });
}

function findNoAttachedDeclaration() {
  return undefined;
}

function lineStartBefore(text, offset) {
  return text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function previousLineBounds(text, lineStart) {
  if (lineStart <= 0) {
    return undefined;
  }
  const end = lineStart - 1;
  const start = text.lastIndexOf("\n", Math.max(0, end - 1)) + 1;
  return { end, start };
}

function lineIndent(line) {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0].length : 0;
}

function isPropertyDeclarationLine(line) {
  const modifierPattern = [...KOTLIN_PROPERTY_MODIFIERS].join("|");
  const pattern = new RegExp(
    `^[ \\t]*(?:(?:${modifierPattern})\\s+)*(?:val|var)\\b`,
  );
  return pattern.test(line);
}

function isDeclarationBoundaryLine(line) {
  const modifierPattern = [...KOTLIN_FUNCTION_MODIFIERS].join("|");
  const pattern = new RegExp(
    `^[ \\t]*(?:(?:${modifierPattern})\\s+)*(?:fun|class|interface|object|constructor|init)\\b`,
  );
  return pattern.test(line);
}

function isAccessorDeclarationLine(line) {
  return /^[ \t]*(?:get|set)\b/.test(line);
}

function isAnnotationLine(line) {
  return /^[ \t]*@/.test(line);
}

function isPropertyAccessorAnnotationContext(text, annotationStart) {
  if (annotationStart === undefined || annotationStart < 0) {
    return false;
  }
  return isPropertyAccessorDeclarationContext(text, annotationStart);
}

function isPropertyAccessorDeclarationContext(text, declarationStart) {
  const declarationLineStart = lineStartBefore(text, declarationStart);
  const sameLinePrefix = text.slice(declarationLineStart, declarationStart);
  if (isPropertyDeclarationLine(sameLinePrefix)) {
    return true;
  }

  const declarationIndent = lineIndent(text.slice(declarationLineStart, declarationStart));
  let bounds = previousLineBounds(text, declarationLineStart);
  while (bounds) {
    const line = text.slice(bounds.start, bounds.end).replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || isAnnotationLine(line) || isAccessorDeclarationLine(line)) {
      bounds = previousLineBounds(text, bounds.start);
      continue;
    }
    if (isPropertyDeclarationLine(line)) {
      return lineIndent(line) <= declarationIndent;
    }
    if (lineIndent(line) < declarationIndent || isDeclarationBoundaryLine(line)) {
      return false;
    }
    bounds = previousLineBounds(text, bounds.start);
  }
  return false;
}

function findNextPropertySetter(text, startIndex, ignoredRanges = []) {
  const declaration = /^(?:val|var)\b/.exec(text.slice(startIndex));
  if (!declaration || declaration[0] !== "var") {
    return undefined;
  }
  return findNextPropertyAccessor(text, startIndex, "value", ignoredRanges);
}

function startsDeclarationLine(text, index) {
  if (index > 0 && text[index - 1] !== "\n" && text[index - 1] !== "\r") {
    return false;
  }
  const modifierPattern = [...KOTLIN_FUNCTION_MODIFIERS].join("|");
  const declarationPattern = new RegExp(
    `^[ \\t]*(?:@|(?:(?:${modifierPattern})\\s+)*(?:fun|class|interface|object)\\b)`,
  );
  return declarationPattern.test(text.slice(index));
}

function startsPropertyDeclarationLine(text, index) {
  if (index > 0 && text[index - 1] !== "\n" && text[index - 1] !== "\r") {
    return false;
  }
  const modifierPattern = [...KOTLIN_PROPERTY_MODIFIERS].join("|");
  const declarationPattern = new RegExp(
    `^[ \\t]*(?:(?:${modifierPattern})\\s+)*(?:val|var)\\b`,
  );
  return declarationPattern.test(text.slice(index));
}

function findFunctionBlockBodyStart(text, startIndex) {
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
    if (angleDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      if (char === "{") {
        return index;
      }
      if (char === "=" || char === ";" || startsDeclarationLine(text, index)) {
        return -1;
      }
    }
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    }
  }
  return -1;
}

function findFunctionExpressionBodyStart(text, startIndex) {
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
    if (angleDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      if (char === "=") {
        return index + 1;
      }
      if (char === "{" || char === ";" || startsDeclarationLine(text, index)) {
        return -1;
      }
    }
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    }
  }
  return -1;
}

function findFunctionExpressionBodyEnd(text, startIndex) {
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
    if (
      hasExpression
      && angleDepth === 0
      && bracketDepth === 0
      && braceDepth === 0
      && parenDepth === 0
      && (char === ";" || char === "}" || startsDeclarationLine(text, index))
    ) {
      return index;
    }
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
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

function collectFunctionBodyRanges(text, ignoredRanges = []) {
  const ranges = [];
  const funPattern = /\bfun\b/g;
  let match = funPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = funPattern.exec(text);
      continue;
    }
    let openParen = findFunctionParameterStart(text, funPattern.lastIndex);
    while (openParen !== -1) {
      const header = text.slice(funPattern.lastIndex, openParen);
      const closeParen = findMatchingParen(text, openParen);
      if (closeParen === -1) {
        openParen = -1;
        continue;
      }
      if (isKotlinFunctionHeader(header)) {
        const bodyStart = findFunctionBlockBodyStart(text, closeParen + 1);
        if (bodyStart !== -1) {
          const bodyEnd = findMatchingBrace(text, bodyStart);
          if (bodyEnd !== -1) {
            ranges.push(...splitRangeAroundObjectExpressionBodies(text, bodyStart + 1, bodyEnd));
          }
        } else {
          const expressionBodyStart = findFunctionExpressionBodyStart(text, closeParen + 1);
          if (expressionBodyStart !== -1) {
            const expressionBodyEnd = findFunctionExpressionBodyEnd(text, expressionBodyStart);
            if (expressionBodyEnd > expressionBodyStart) {
              ranges.push(...splitRangeAroundObjectExpressionBodies(
                text,
                expressionBodyStart,
                expressionBodyEnd,
              ));
            }
          }
        }
        break;
      }
      openParen = findFunctionParameterStart(text, closeParen + 1);
    }
    match = funPattern.exec(text);
  }
  return ranges;
}

function collectInitBlockBodyRanges(text, ignoredRanges = []) {
  const ranges = [];
  const initPattern = /\binit\b/g;
  let match = initPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = initPattern.exec(text);
      continue;
    }
    const bodyStart = skipWhitespaceAndComments(text, initPattern.lastIndex);
    if (text[bodyStart] === "{") {
      const bodyEnd = findMatchingBrace(text, bodyStart);
      if (bodyEnd !== -1) {
        ranges.push(...splitRangeAroundObjectExpressionBodies(text, bodyStart + 1, bodyEnd));
        initPattern.lastIndex = bodyEnd + 1;
      }
    }
    match = initPattern.exec(text);
  }
  return ranges;
}

function isSecondaryConstructorStart(text, startIndex) {
  const lineStart = lineStartBefore(text, startIndex);
  let index = lineStart;
  while (index < startIndex) {
    if (text[index] === " " || text[index] === "\t") {
      index += 1;
      continue;
    }
    if (text[index] === "@") {
      const next = skipKotlinAnnotation(text, index);
      if (next === index || next > startIndex) {
        return false;
      }
      index = next;
      continue;
    }
    const token = /^[A-Za-z_]\w*/.exec(text.slice(index, startIndex));
    if (token && KOTLIN_FUNCTION_MODIFIERS.has(token[0])) {
      index += token[0].length;
      continue;
    }
    return false;
  }
  return true;
}

function collectConstructorBodyRanges(text, ignoredRanges = []) {
  const ranges = [];
  const constructorPattern = /\bconstructor\b/g;
  let match = constructorPattern.exec(text);
  while (match) {
    if (
      isInIgnoredRange(match.index, ignoredRanges)
      || !isSecondaryConstructorStart(text, match.index)
    ) {
      match = constructorPattern.exec(text);
      continue;
    }
    const openParen = skipWhitespaceAndComments(text, constructorPattern.lastIndex);
    if (text[openParen] !== "(") {
      match = constructorPattern.exec(text);
      continue;
    }
    const closeParen = findMatchingParen(text, openParen);
    if (closeParen === -1) {
      match = constructorPattern.exec(text);
      continue;
    }
    const bodyStart = findFunctionBlockBodyStart(text, closeParen + 1);
    if (bodyStart !== -1) {
      const bodyEnd = findMatchingBrace(text, bodyStart);
      if (bodyEnd !== -1) {
        ranges.push(...splitRangeAroundObjectExpressionBodies(text, bodyStart + 1, bodyEnd));
        constructorPattern.lastIndex = bodyEnd + 1;
      }
    }
    match = constructorPattern.exec(text);
  }
  return ranges;
}

function collectPropertyAccessorBodyRanges(text, ignoredRanges = []) {
  const ranges = [];
  const accessorPattern = /\b(?:get|set)\b/g;
  let match = accessorPattern.exec(text);
  while (match) {
    if (
      isInIgnoredRange(match.index, ignoredRanges)
      || !isPropertyAccessorDeclarationContext(text, match.index)
    ) {
      match = accessorPattern.exec(text);
      continue;
    }
    let bodyStart = skipWhitespaceAndComments(text, accessorPattern.lastIndex);
    if (text[bodyStart] === "(") {
      const closeParen = findMatchingParen(text, bodyStart);
      if (closeParen === -1) {
        match = accessorPattern.exec(text);
        continue;
      }
      bodyStart = skipWhitespaceAndComments(text, closeParen + 1);
    }
    if (text[bodyStart] === "{") {
      const bodyEnd = findMatchingBrace(text, bodyStart);
      if (bodyEnd !== -1) {
        ranges.push(...splitRangeAroundObjectExpressionBodies(text, bodyStart + 1, bodyEnd));
        accessorPattern.lastIndex = bodyEnd + 1;
      }
    } else {
      const expressionBodyStart = findFunctionExpressionBodyStart(text, bodyStart);
      if (expressionBodyStart !== -1) {
        const expressionBodyEnd = findFunctionExpressionBodyEnd(text, expressionBodyStart);
        if (expressionBodyEnd > expressionBodyStart) {
          ranges.push(...splitRangeAroundObjectExpressionBodies(
            text,
            expressionBodyStart,
            expressionBodyEnd,
          ));
          accessorPattern.lastIndex = expressionBodyEnd;
        }
      }
    }
    match = accessorPattern.exec(text);
  }
  return ranges;
}

function isIdentifierCharacter(char) {
  return /[A-Za-z_0-9]/.test(char || "");
}

function isKeywordAt(text, index, keyword) {
  return text.startsWith(keyword, index)
    && !isIdentifierCharacter(text[index - 1])
    && !isIdentifierCharacter(text[index + keyword.length]);
}

function findObjectExpressionBodyStart(text, startIndex, endIndex) {
  let angleDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let inBacktickIdentifier = false;
  let quote;

  for (let index = startIndex; index < endIndex; index += 1) {
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
    if (char === "`") {
      inBacktickIdentifier = !inBacktickIdentifier;
      continue;
    }
    if (inBacktickIdentifier) {
      continue;
    }

    if (angleDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      if (char === "{") {
        return index;
      }
      if (char === ";" || startsDeclarationLine(text, index)) {
        return -1;
      }
    }

    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    }
  }
  return -1;
}

function collectObjectExpressionBodyRanges(text, startIndex, endIndex) {
  const ranges = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (text.startsWith("\"\"\"", index)) {
      const closeIndex = text.indexOf("\"\"\"", index + 3);
      index = closeIndex === -1 ? endIndex - 1 : closeIndex + 2;
      continue;
    }
    if (text[index] === "\"" || text[index] === "'") {
      index = findQuotedEnd(text, index, text[index]) - 1;
      continue;
    }
    const keywordLength = methodOwnerKeywordLengthAt(text, index);
    if (keywordLength === 0) {
      continue;
    }

    const bodyStart = findObjectExpressionBodyStart(text, index + keywordLength, endIndex);
    if (bodyStart === -1) {
      continue;
    }
    const bodyEnd = findMatchingBrace(text, bodyStart);
    if (bodyEnd === -1 || bodyEnd > endIndex) {
      continue;
    }
    ranges.push({
      end: bodyEnd,
      start: bodyStart + 1,
    });
    index = bodyEnd;
  }
  return ranges;
}

function methodOwnerKeywordLengthAt(text, index) {
  if (isKeywordAt(text, index, "object")) {
    return "object".length;
  }
  if (
    isKeywordAt(text, index, "class")
    && text[index - 1] !== ":"
    && text[index - 1] !== "."
  ) {
    return "class".length;
  }
  if (isKeywordAt(text, index, "interface")) {
    return "interface".length;
  }
  return 0;
}

function splitRangeAroundObjectExpressionBodies(text, start, end) {
  const objectBodies = collectObjectExpressionBodyRanges(text, start, end);
  if (objectBodies.length === 0) {
    return [{ end, start }];
  }

  const ranges = [];
  let cursor = start;
  for (const body of objectBodies) {
    if (body.start > cursor) {
      ranges.push({
        end: body.start,
        start: cursor,
      });
    }
    cursor = Math.max(cursor, body.end);
  }
  if (cursor < end) {
    ranges.push({ end, start: cursor });
  }
  return ranges;
}

function findPropertyDelegateExpressionStart(text, startIndex) {
  let angleDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let inBacktickIdentifier = false;
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
    if (char === "`") {
      inBacktickIdentifier = !inBacktickIdentifier;
      continue;
    }
    if (inBacktickIdentifier) {
      continue;
    }

    if (angleDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      if (isKeywordAt(text, index, "by")) {
        return skipWhitespaceAndComments(text, index + 2);
      }
      if (
        char === "="
        || char === ";"
        || isPropertyAccessorStart(text, index, startIndex)
        || startsDeclarationLine(text, index)
        || startsPropertyDeclarationLine(text, index)
      ) {
        return -1;
      }
    }

    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">" && angleDepth > 0 && !isFunctionTypeArrowClose(text, index)) {
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")" && parenDepth > 0) {
      parenDepth -= 1;
    }
  }
  return -1;
}

function collectPropertyInitializerRanges(text, ignoredRanges = []) {
  const ranges = [];
  const propertyPattern = /\b(?:val|var)\b/g;
  let match = propertyPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = propertyPattern.exec(text);
      continue;
    }
    const headerStart = skipWhitespaceAndComments(text, propertyPattern.lastIndex);
    const headerEnd = findPropertyHeaderEnd(text, headerStart);
    if (text[headerEnd] === "=") {
      const initializerStart = skipWhitespaceAndComments(text, headerEnd + 1);
      const initializerEnd = findFunctionExpressionBodyEnd(text, initializerStart);
      if (initializerEnd > initializerStart) {
        ranges.push(...splitRangeAroundObjectExpressionBodies(text, initializerStart, initializerEnd));
        propertyPattern.lastIndex = initializerEnd;
      }
    } else {
      const delegateStart = findPropertyDelegateExpressionStart(text, propertyPattern.lastIndex);
      if (delegateStart !== -1) {
        const delegateEnd = findFunctionExpressionBodyEnd(text, delegateStart);
        if (delegateEnd > delegateStart) {
          ranges.push(...splitRangeAroundObjectExpressionBodies(text, delegateStart, delegateEnd));
          propertyPattern.lastIndex = delegateEnd;
        }
      }
    }
    match = propertyPattern.exec(text);
  }
  return ranges;
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

function readKotlinAnnotationApplication(text, startIndex) {
  if (text[startIndex] !== "@") {
    return undefined;
  }

  let index = skipWhitespaceAndComments(text, startIndex + 1);
  let useSiteTarget;
  const target = /^[A-Za-z_]\w*/.exec(text.slice(index));
  if (target && KOTLIN_ANNOTATION_USE_SITE_TARGETS.has(target[0])) {
    const colonIndex = skipWhitespaceAndComments(text, index + target[0].length);
    if (text[colonIndex] === ":") {
      useSiteTarget = target[0];
      index = skipWhitespaceAndComments(text, colonIndex + 1);
    }
  }

  if (text[index] === "[") {
    const closeBracket = findMatchingBracket(text, index);
    return {
      closeBracket,
      end: closeBracket === -1 ? text.length : closeBracket + 1,
      kind: "group",
      openBracket: index,
      useSiteTarget,
    };
  }

  const namePattern = new RegExp(`^${KOTLIN_ANNOTATION_NAME_PATTERN}`);
  const name = namePattern.exec(text.slice(index));
  if (!name) {
    return undefined;
  }

  const annotationName = name[0];
  index += name[0].length;
  index = skipWhitespaceAndComments(text, index);
  if (text[index] === "(") {
    const closeParen = findMatchingParen(text, index);
    return {
      annotationName,
      closeParen,
      end: closeParen === -1 ? text.length : closeParen + 1,
      kind: "annotation",
      openParen: index,
      useSiteTarget,
    };
  }
  return {
    annotationName,
    closeParen: -1,
    end: index,
    kind: "annotation",
    openParen: -1,
    useSiteTarget,
  };
}

function skipKotlinAnnotation(text, startIndex) {
  const annotation = readKotlinAnnotationApplication(text, startIndex);
  return annotation === undefined ? startIndex : annotation.end;
}

function skipKotlinContextParameters(text, startIndex) {
  if (!text.startsWith("context", startIndex)) {
    return startIndex;
  }
  const afterKeyword = startIndex + "context".length;
  if (/\w/.test(text[afterKeyword] || "")) {
    return startIndex;
  }
  const openParen = skipWhitespaceAndComments(text, afterKeyword);
  if (text[openParen] !== "(") {
    return startIndex;
  }
  const closeParen = findMatchingParen(text, openParen);
  return closeParen === -1 ? text.length : closeParen + 1;
}

function findAttachedFunction(text, startIndex, ignoredRanges = [], annotationStart) {
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

    const contextEnd = skipKotlinContextParameters(text, index);
    if (contextEnd !== index) {
      index = contextEnd;
      continue;
    }

    const token = /^[A-Za-z_]\w*/.exec(text.slice(index));
    if (!token) {
      return undefined;
    }
    if (token[0] === "fun") {
      return findNextFunction(text, index, ignoredRanges);
    }
    if (token[0] === "get" && isPropertyAccessorAnnotationContext(text, annotationStart)) {
      return findNextGetterAccessor(text, index, ignoredRanges);
    }
    if (token[0] === "set" && isPropertyAccessorAnnotationContext(text, annotationStart)) {
      return findNextSetterAccessor(text, index, ignoredRanges);
    }
    if (KOTLIN_FUNCTION_MODIFIERS.has(token[0])) {
      index += token[0].length;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function findAttachedPropertyGetter(text, startIndex, ignoredRanges = []) {
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

    const contextEnd = skipKotlinContextParameters(text, index);
    if (contextEnd !== index) {
      index = contextEnd;
      continue;
    }

    const token = /^[A-Za-z_]\w*/.exec(text.slice(index));
    if (!token) {
      return undefined;
    }
    if (token[0] === "val" || token[0] === "var") {
      return findNextPropertyGetter(text, index, ignoredRanges);
    }
    if (KOTLIN_PROPERTY_MODIFIERS.has(token[0])) {
      index += token[0].length;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function findAttachedPropertySetter(text, startIndex, ignoredRanges = []) {
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

    const contextEnd = skipKotlinContextParameters(text, index);
    if (contextEnd !== index) {
      index = contextEnd;
      continue;
    }

    const token = /^[A-Za-z_]\w*/.exec(text.slice(index));
    if (!token) {
      return undefined;
    }
    if (token[0] === "val" || token[0] === "var") {
      return findNextPropertySetter(text, index, ignoredRanges);
    }
    if (KOTLIN_PROPERTY_MODIFIERS.has(token[0])) {
      index += token[0].length;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function findAttachedPropertyAccessor(useSiteTarget) {
  if (useSiteTarget === "get") {
    return findAttachedPropertyGetter;
  }
  if (useSiteTarget === "set") {
    return findAttachedPropertySetter;
  }
  if (useSiteTarget !== undefined) {
    return findNoAttachedDeclaration;
  }
  return findAttachedFunction;
}

function firstSignificantLineOffset(text, lineStart, lineEnd) {
  let index = lineStart;
  while (index < lineEnd) {
    if (/\s/.test(text[index])) {
      index += 1;
      continue;
    }
    const commentEnd = findCommentEnd(text, index);
    if (commentEnd !== undefined) {
      if (commentEnd > lineEnd) {
        return undefined;
      }
      index = commentEnd;
      continue;
    }
    return index;
  }
  return undefined;
}

function kotlinSourceLines(text, ignoredRanges) {
  const lines = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd === -1) {
      lineEnd = text.length;
    }
    const significantOffset = firstSignificantLineOffset(text, lineStart, lineEnd);
    if (
      significantOffset !== undefined
      && !isInIgnoredRange(significantOffset, ignoredRanges)
    ) {
      lines.push(removeKotlinComments(text.slice(lineStart, lineEnd)).replace(/\r$/, "").trim());
    }
    if (lineEnd === text.length) {
      break;
    }
    lineStart = lineEnd + 1;
  }
  return lines;
}

function stepAnnotationImports(text, ignoredRanges = []) {
  const named = new Map();
  const wildcards = new Set();
  const importPattern = new RegExp(
    `^import\\s+(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*(?:\\.\\*)?)(?:\\s+as\\s+(${KOTLIN_IDENTIFIER_PATTERN}))?\\s*$`,
  );
  const typeAliasPattern = new RegExp(
    `^(?:(?:public|private|internal|expect|actual)\\s+)*typealias\\s+(${KOTLIN_IDENTIFIER_PATTERN})\\s*=\\s*(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*)\\s*$`,
  );
  for (const line of kotlinSourceLines(text, ignoredRanges)) {
    let match = importPattern.exec(line);
    if (match) {
      const importedName = normalizeKotlinIdentifierPath(match[1]);
      const alias = match[2] === undefined ? undefined : normalizeKotlinIdentifier(match[2]);
      if (match[1].endsWith(".*")) {
        wildcards.add(importedName.slice(0, -2));
        continue;
      }

      const importedParts = importedName.split(".");
      const exposedName = alias || importedParts[importedParts.length - 1];
      if (importedParts[importedParts.length - 1] === "Step") {
        named.set(exposedName, importedName);
      }
      continue;
    }

    match = typeAliasPattern.exec(line);
    if (match) {
      named.set(normalizeKotlinIdentifier(match[1]), normalizeKotlinIdentifierPath(match[2]));
    }
  }
  return { named, wildcards };
}

function isTopLevelOffset(text, offset) {
  let braceDepth = 0;
  let quote;
  for (let index = 0; index < offset; index += 1) {
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
      braceDepth += 1;
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
    }
  }
  return braceDepth === 0;
}

function localClassifierNames(text, ignoredRanges) {
  const names = new Set();
  const searchableText = replaceKotlinCommentsWithSpaces(text);
  const pattern = new RegExp(
    `\\b(?:annotation\\s+class|class|interface|object)\\s+(${KOTLIN_IDENTIFIER_PATTERN})`,
    "g",
  );
  let match = pattern.exec(searchableText);
  while (match) {
    if (!isInIgnoredRange(match.index, ignoredRanges) && isTopLevelOffset(text, match.index)) {
      names.add(normalizeKotlinIdentifier(match[1]));
    }
    match = pattern.exec(searchableText);
  }
  return names;
}

function collectClassifierScopeRanges(text, ignoredRanges) {
  const ranges = [];
  const searchableText = replaceKotlinCommentsWithSpaces(text);
  const pattern = new RegExp(
    `\\b(?:annotation\\s+class|class|interface|object)\\s+(${KOTLIN_IDENTIFIER_PATTERN})`,
    "g",
  );
  let match = pattern.exec(searchableText);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = pattern.exec(searchableText);
      continue;
    }

    const bodyStart = findObjectBodyStart(text, pattern.lastIndex);
    if (bodyStart !== -1) {
      const bodyEnd = findMatchingBrace(text, bodyStart);
      if (bodyEnd !== -1) {
        ranges.push({
          end: bodyEnd,
          start: bodyStart + 1,
        });
        pattern.lastIndex = bodyStart + 1;
      }
    }
    match = pattern.exec(searchableText);
  }
  return ranges;
}

function isInsideRange(offset, range) {
  return offset >= range.start && offset < range.end;
}

function isInsideChildScope(offset, scope, scopes) {
  return scopes.some((candidate) => (
    candidate.start > scope.start
    && candidate.end <= scope.end
    && isInsideRange(offset, candidate)
  ));
}

function directClassifierNamesInScope(text, ignoredRanges, scope, scopes) {
  const names = new Set();
  const searchableText = replaceKotlinCommentsWithSpaces(text);
  const pattern = new RegExp(
    `\\b(?:annotation\\s+class|class|interface|object)\\s+(${KOTLIN_IDENTIFIER_PATTERN})`,
    "g",
  );
  pattern.lastIndex = scope.start;
  let match = pattern.exec(searchableText);
  while (match && match.index < scope.end) {
    if (
      !isInIgnoredRange(match.index, ignoredRanges)
      && !isInsideChildScope(match.index, scope, scopes)
    ) {
      names.add(normalizeKotlinIdentifier(match[1]));
    }
    match = pattern.exec(searchableText);
  }
  return names;
}

function localClassifierNamesAtOffset(text, ignoredRanges, offset) {
  const names = localClassifierNames(text, ignoredRanges);
  const scopes = collectClassifierScopeRanges(text, ignoredRanges);
  const enclosingScopes = scopes
    .filter((scope) => isInsideRange(offset, scope))
    .sort((left, right) => left.start - right.start);

  for (const scope of enclosingScopes) {
    for (const name of directClassifierNamesInScope(text, ignoredRanges, scope, scopes)) {
      names.add(name);
    }
  }
  return names;
}

function resolveStepAnnotationTarget(annotationName, namedImports, seen = new Set()) {
  const normalizedName = normalizeKotlinIdentifierPath(annotationName);
  if (normalizedName === GAUGE_STEP_ANNOTATION) {
    return normalizedName;
  }
  if (!namedImports.has(normalizedName) || seen.has(normalizedName)) {
    return normalizedName;
  }
  seen.add(normalizedName);
  return resolveStepAnnotationTarget(namedImports.get(normalizedName), namedImports, seen);
}

function isStepAnnotationAllowed(annotationName, stepImports, localClassifierNames = new Set()) {
  const normalizedName = normalizeKotlinIdentifierPath(annotationName);
  if (normalizedName === GAUGE_STEP_ANNOTATION) {
    return true;
  }
  if (normalizedName.includes(".")) {
    return false;
  }
  if (localClassifierNames.has(normalizedName)) {
    return false;
  }
  if (stepImports.named.has(normalizedName)) {
    return resolveStepAnnotationTarget(normalizedName, stepImports.named) === GAUGE_STEP_ANNOTATION;
  }
  if (normalizedName === "Step" && stepImports.wildcards.size > 0) {
    return stepImports.wildcards.size === 1 && stepImports.wildcards.has(GAUGE_STEP_PACKAGE);
  }
  return normalizedName === "Step";
}

function addStepFunctionEntry(
  entries,
  text,
  constants,
  constantTypes,
  ignoredRanges,
  stepImports,
  functionBodyRanges,
  annotationName,
  openParen,
  functionSearchStart,
  findAttachedDeclaration = findAttachedFunction,
  annotationStart = -1,
) {
  if (functionBodyRanges.some((range) => isInsideRange(openParen, range))) {
    return;
  }
  const classifierNames = localClassifierNamesAtOffset(text, ignoredRanges, openParen);
  if (!isStepAnnotationAllowed(annotationName, stepImports, classifierNames)) {
    return;
  }
  const closeParen = findMatchingParen(text, openParen);
  if (closeParen === -1) {
    return;
  }
  const aliases = extractStepAliases(text.slice(openParen + 1, closeParen), constants, constantTypes);
  const method = findAttachedDeclaration(text, functionSearchStart(closeParen), ignoredRanges, annotationStart);
  if (aliases.length > 0 && method) {
    entries.push({ aliases, ...method });
  }
}

function addGroupedStepFunctions(entries, text, constants, constantTypes, ignoredRanges, stepImports, functionBodyRanges) {
  const groupPattern = /@/g;
  let groupMatch = groupPattern.exec(text);
  while (groupMatch) {
    if (isInIgnoredRange(groupMatch.index, ignoredRanges)) {
      groupMatch = groupPattern.exec(text);
      continue;
    }
    const group = readKotlinAnnotationApplication(text, groupMatch.index);
    if (
      group === undefined
      || group.kind !== "group"
      || group.openBracket === -1
      || group.closeBracket === -1
    ) {
      if (group && group.end > groupPattern.lastIndex) {
        groupPattern.lastIndex = group.end;
      }
      groupMatch = groupPattern.exec(text);
      continue;
    }

    const openBracket = group.openBracket;
    const closeBracket = group.closeBracket;

    const groupStart = openBracket + 1;
    const findAttachedDeclaration = findAttachedPropertyAccessor(group.useSiteTarget);
    const annotationPattern = new RegExp(KOTLIN_ANNOTATION_NAME_PATTERN, "g");
    annotationPattern.lastIndex = groupStart;
    let annotationMatch = annotationPattern.exec(text);
    while (annotationMatch && annotationMatch.index < closeBracket) {
      if (isInIgnoredRange(annotationMatch.index, ignoredRanges)) {
        annotationMatch = annotationPattern.exec(text);
        continue;
      }
      const openParen = skipWhitespaceAndComments(text, annotationPattern.lastIndex);
      if (text[openParen] !== "(") {
        annotationMatch = annotationPattern.exec(text);
        continue;
      }
      const closeParen = findMatchingParen(text, openParen);
      if (closeParen === -1 || closeParen > closeBracket) {
        annotationPattern.lastIndex = openParen + 1;
        annotationMatch = annotationPattern.exec(text);
        continue;
      }

      addStepFunctionEntry(
        entries,
        text,
        constants,
        constantTypes,
        ignoredRanges,
        stepImports,
        functionBodyRanges,
        annotationMatch[0],
        openParen,
        () => closeBracket + 1,
        findAttachedDeclaration,
        groupMatch.index,
      );
      annotationPattern.lastIndex = closeParen + 1;
      annotationMatch = annotationPattern.exec(text);
    }
    groupPattern.lastIndex = group.end;
    groupMatch = groupPattern.exec(text);
  }
}

function findStepFunctions(text) {
  const entries = [];
  const annotationPattern = /@/g;
  const { constants, constantTypes } = collectStringConstants(text);
  const ignoredRanges = collectIgnoredKotlinRanges(text);
  const stepImports = stepAnnotationImports(text, ignoredRanges);
  const functionBodyRanges = [
    ...collectFunctionBodyRanges(text, ignoredRanges),
    ...collectInitBlockBodyRanges(text, ignoredRanges),
    ...collectConstructorBodyRanges(text, ignoredRanges),
    ...collectPropertyAccessorBodyRanges(text, ignoredRanges),
    ...collectPropertyInitializerRanges(text, ignoredRanges),
  ];
  addGroupedStepFunctions(entries, text, constants, constantTypes, ignoredRanges, stepImports, functionBodyRanges);
  let annotationMatch = annotationPattern.exec(text);
  while (annotationMatch) {
    if (isInIgnoredRange(annotationMatch.index, ignoredRanges)) {
      annotationMatch = annotationPattern.exec(text);
      continue;
    }
    const annotation = readKotlinAnnotationApplication(text, annotationMatch.index);
    if (
      annotation === undefined
      || annotation.kind !== "annotation"
      || annotation.openParen === -1
      || annotation.closeParen === -1
    ) {
      if (annotation && annotation.end > annotationPattern.lastIndex) {
        annotationPattern.lastIndex = annotation.end;
      }
      annotationMatch = annotationPattern.exec(text);
      continue;
    }
    const findAttachedDeclaration = findAttachedPropertyAccessor(annotation.useSiteTarget);
    addStepFunctionEntry(
      entries,
      text,
      constants,
      constantTypes,
      ignoredRanges,
      stepImports,
      functionBodyRanges,
      annotation.annotationName,
      annotation.openParen,
      () => annotation.closeParen + 1,
      findAttachedDeclaration,
      annotationMatch.index,
    );
    annotationPattern.lastIndex = annotation.end;
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
