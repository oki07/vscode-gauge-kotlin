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

const KOTLIN_IDENTIFIER_PATTERN = "(?:[A-Za-z_]\\w*|`[^`\\r\\n]+`)";
const KOTLIN_IDENTIFIER_PATH_PATTERN = new RegExp(
  `^${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*$`,
);

function isKotlinIdentifierPath(value) {
  return KOTLIN_IDENTIFIER_PATH_PATTERN.test(value);
}

const KOTLIN_NUMERIC_TYPES = new Set(["Byte", "Short", "Int", "Long", "Float", "Double"]);

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
  const integerLiteral = "[+-]?(?:0|[1-9][0-9_]*|0[xX][0-9A-Fa-f_]+|0[bB][01_]+)(?:L)?";
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
  const pattern = new RegExp(
    `\\bconst\\s+val\\s+(${KOTLIN_IDENTIFIER_PATTERN})\\s*(?::\\s*((?:[A-Za-z_]\\w*\\.)*(?:String|Char|Byte|Short|Int|Long|Float|Double|Boolean)))?\\s*=`,
    "g",
  );
  let match = pattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = pattern.exec(text);
      continue;
    }

    const expressionStart = pattern.lastIndex;
    const expressionEnd = findConstExpressionEnd(text, expressionStart);
    const objectPaths = enclosingObjectPaths(objectRanges, match.index);
    const names = new Set([match[1]]);
    for (const objectPath of objectPaths) {
      if (objectPath.length > 0) {
        names.add(`${objectPath.join(".")}.${match[1]}`);
      }
    }
    expressions.push({
      expression: text.slice(expressionStart, expressionEnd),
      names: [...names],
      typeName: canonicalKotlinTypeName(match[2]),
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

function localClassifierNames(text, ignoredRanges) {
  const names = new Set();
  const pattern = new RegExp(
    `\\b(?:annotation\\s+class|class|interface|object)\\s+(${KOTLIN_IDENTIFIER_PATTERN})`,
    "g",
  );
  let match = pattern.exec(text);
  while (match) {
    if (!isInIgnoredRange(match.index, ignoredRanges)) {
      names.add(match[1]);
    }
    match = pattern.exec(text);
  }
  return names;
}

function isStepAnnotationAllowed(annotationName, stepImports, localClassifierNames = new Set()) {
  if (annotationName === GAUGE_STEP_ANNOTATION) {
    return true;
  }
  if (annotationName.includes(".")) {
    return false;
  }
  if (stepImports.has(annotationName)) {
    return stepImports.get(annotationName) === GAUGE_STEP_ANNOTATION;
  }
  if (localClassifierNames.has(annotationName)) {
    return false;
  }
  return annotationName === "Step";
}

function findStepFunctions(text) {
  const entries = [];
  const annotationPattern = /@((?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*)\b/g;
  const constants = collectStringConstants(text);
  const ignoredRanges = collectIgnoredKotlinRanges(text);
  const stepImports = stepAnnotationImports(text);
  const classifierNames = localClassifierNames(text, ignoredRanges);
  let annotationMatch = annotationPattern.exec(text);
  while (annotationMatch) {
    if (isInIgnoredRange(annotationMatch.index, ignoredRanges)) {
      annotationMatch = annotationPattern.exec(text);
      continue;
    }
    const annotationName = annotationMatch[1];
    if (!isStepAnnotationAllowed(annotationName, stepImports, classifierNames)) {
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
