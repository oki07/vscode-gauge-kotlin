"use strict";

const COLLECTION_NAME = "gauge-kotlin";
const GAUGE_LANGUAGE = "gauge";
const JAVA_LANGUAGE = "java";
const KOTLIN_LANGUAGE = "kotlin";
const BLANK_STEP_MESSAGE = "Step should not be blank";
const PARAMETER_MISMATCH_PREFIX = "Parameter count mismatch";
const UNDEFINED_STEP_MESSAGE = "Undefined Step";
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

function createDiagnostic(vscode, range, message, options = {}) {
  const severity = vscode.DiagnosticSeverity && vscode.DiagnosticSeverity.Error;
  const diagnostic = typeof vscode.Diagnostic === "function"
    ? new vscode.Diagnostic(range, message, severity)
    : { range, message, severity };
  if (options.code !== undefined) {
    diagnostic.code = options.code;
  }
  if (options.source !== undefined) {
    diagnostic.source = options.source;
  }
  return diagnostic;
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

const KOTLIN_BARE_IDENTIFIER_PATTERN = "[\\p{L}_][\\p{L}\\p{N}_]*";
const KOTLIN_BACKTICK_IDENTIFIER_PATTERN = "`[^`\\r\\n]+`";
const KOTLIN_IDENTIFIER_PATTERN =
  `(?:${KOTLIN_BARE_IDENTIFIER_PATTERN}|${KOTLIN_BACKTICK_IDENTIFIER_PATTERN})`;
const KOTLIN_ANNOTATION_NAME_PATTERN = `${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*`;
const KOTLIN_IDENTIFIER_PATH_PATTERN = new RegExp(
  `^${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*$`,
  "u",
);
const KOTLIN_IDENTIFIER_START_CHARACTER_PATTERN = /^[\p{L}_]$/u;
const KOTLIN_IDENTIFIER_REGEXP = new RegExp(`^${KOTLIN_IDENTIFIER_PATTERN}`, "u");
const KOTLIN_BARE_IDENTIFIER_REGEXP = new RegExp(`^${KOTLIN_BARE_IDENTIFIER_PATTERN}$`, "u");

function matchKotlinIdentifierStart(text) {
  return KOTLIN_IDENTIFIER_REGEXP.exec(text);
}

function isKotlinIdentifierStartCharacter(char) {
  return Boolean(char && KOTLIN_IDENTIFIER_START_CHARACTER_PATTERN.test(char));
}

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
      const match = matchKotlinIdentifierStart(value.slice(index));
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

function readKotlinIdentifierPath(text, startIndex) {
  const segments = [];
  let index = skipWhitespaceAndComments(text, startIndex);
  while (text[index] === "@") {
    const next = skipKotlinAnnotation(text, index);
    if (next === index) {
      return undefined;
    }
    index = skipWhitespaceAndComments(text, next);
  }
  while (index < text.length) {
    const match = matchKotlinIdentifierStart(text.slice(index));
    if (!match) {
      break;
    }
    segments.push(match[0]);
    index = skipWhitespaceAndComments(text, index + match[0].length);
    if (text[index] !== ".") {
      break;
    }
    index = skipWhitespaceAndComments(text, index + 1);
  }
  if (segments.length === 0) {
    return undefined;
  }
  return {
    end: index,
    path: segments.join("."),
  };
}

function resolveKotlinConstantReference(name, constants, constantTypes) {
  const trimmed = normalizeKotlinQualifiedPathDots(name.trim());
  if (!isKotlinIdentifierPath(trimmed) || constants === undefined) {
    return undefined;
  }
  let resolvedName = trimmed;
  if (!constants.has(resolvedName)) {
    resolvedName = normalizeKotlinIdentifierPath(trimmed);
  }
  if (!constants.has(resolvedName)) {
    return undefined;
  }
  return {
    value: constants.get(resolvedName),
    typeName: constantTypes && constantTypes.get(resolvedName),
  };
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
const KOTLIN_CONST_TYPES = new Set([
  "String",
  "Char",
  "Boolean",
  ...KOTLIN_NUMERIC_TYPES,
]);
const KOTLIN_TYPEALIAS_MODIFIERS = new Set([
  "public",
  "private",
  "internal",
  "expect",
  "actual",
]);

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

function isKotlinConstType(typeName) {
  return KOTLIN_CONST_TYPES.has(canonicalKotlinTypeName(typeName));
}

function stripKotlinTypeAliasPreamble(line) {
  let index = 0;
  while (index < line.length) {
    index = skipWhitespaceAndComments(line, index);
    if (line[index] === "@") {
      const next = skipKotlinAnnotation(line, index);
      if (next === index) {
        break;
      }
      index = next;
      continue;
    }

    const modifier = /^[A-Za-z_]\w*/.exec(line.slice(index));
    if (modifier && KOTLIN_TYPEALIAS_MODIFIERS.has(modifier[0])) {
      index += modifier[0].length;
      continue;
    }

    break;
  }
  return line.slice(index).trim();
}

function normalizeKotlinQualifiedPathDots(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end === -1) {
        result += text.slice(index);
        break;
      }
      result += text.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (text[index] === ".") {
      result = result.replace(/\s+$/, "");
      result += ".";
      index += 1;
      while (index < text.length && /\s/.test(text[index])) {
        index += 1;
      }
      continue;
    }
    result += text[index];
    index += 1;
  }
  return result.trim();
}

function stripKotlinTypeAliasTargetAnnotations(statement) {
  const equalsIndex = findTopLevelChar(statement, "=");
  if (equalsIndex === -1) {
    return statement;
  }

  const targetStart = skipWhitespaceAndComments(statement, equalsIndex + 1);
  let index = targetStart;
  while (statement[index] === "@") {
    const next = skipKotlinAnnotation(statement, index);
    if (next === index) {
      break;
    }
    index = skipWhitespaceAndComments(statement, next);
  }
  if (index === targetStart) {
    return statement;
  }
  return `${statement.slice(0, targetStart)}${statement.slice(index)}`;
}

function normalizeKotlinTypeAliasStatementForMatch(statement) {
  return stripKotlinTypeAliasTargetAnnotations(
    normalizeKotlinQualifiedPathDots(stripKotlinTypeAliasPreamble(statement)),
  );
}

function normalizeKotlinImportStatementForMatch(statement) {
  return normalizeKotlinQualifiedPathDots(statement);
}

function startsKotlinImportDeclaration(line) {
  return /^import(?:\s|$)/.test(line);
}

function shouldContinueKotlinImportStatement(statement, nextLine) {
  const normalizedStatement = normalizeKotlinImportStatementForMatch(statement);
  const trimmedNextLine = nextLine.trim();
  return normalizedStatement.endsWith(".")
    || trimmedNextLine.startsWith(".")
    || /^as(?:\s|$)/.test(trimmedNextLine);
}

function readKotlinImportStatement(lines, startIndex, importPattern) {
  let statement = lines[startIndex];
  if (!startsKotlinImportDeclaration(statement)) {
    return { endIndex: startIndex, statement };
  }

  for (let index = startIndex; index < lines.length; index += 1) {
    const normalizedStatement = normalizeKotlinImportStatementForMatch(statement);
    const nextLine = lines[index + 1];
    if (
      importPattern.test(normalizedStatement)
      && (nextLine === undefined || !/^as(?:\s|$)/.test(nextLine.trim()))
    ) {
      return { endIndex: index, statement };
    }
    if (
      nextLine === undefined
      || startsKotlinImportDeclaration(nextLine)
      || startsKotlinTypeAliasDeclaration(nextLine)
      || !shouldContinueKotlinImportStatement(statement, nextLine)
    ) {
      return { endIndex: index, statement };
    }
    statement = `${statement} ${nextLine}`;
  }
  return { endIndex: lines.length - 1, statement };
}

function collectKotlinTypeAliases(text, ignoredRanges = []) {
  const aliases = new Map();
  const importPattern = new RegExp(
    `^import\\s+(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*)(?:\\s+as\\s+(${KOTLIN_IDENTIFIER_PATTERN}))?\\s*$`,
    "u",
  );
  const typeAliasPattern = new RegExp(
    `^typealias\\s+(${KOTLIN_IDENTIFIER_PATTERN})\\s*=\\s*(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*)\\s*$`,
    "u",
  );
  const lines = kotlinSourceLines(text, ignoredRanges);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const importStatement = readKotlinImportStatement(lines, lineIndex, importPattern);
    let match = importPattern.exec(normalizeKotlinImportStatementForMatch(importStatement.statement));
    if (match) {
      const importedName = normalizeKotlinIdentifierPath(match[1]);
      if (resolveKotlinConstTypeName(importedName) !== undefined) {
        const importedParts = importedName.split(".");
        const exposedName = match[2] === undefined
          ? importedParts[importedParts.length - 1]
          : normalizeKotlinIdentifier(match[2]);
        aliases.set(exposedName, importedName);
      }
      lineIndex = importStatement.endIndex;
      continue;
    }

    const statement = readKotlinTypeAliasStatement(lines, lineIndex, typeAliasPattern);
    match = typeAliasPattern.exec(normalizeKotlinTypeAliasStatementForMatch(statement.statement));
    if (match) {
      aliases.set(
        normalizeKotlinIdentifier(match[1]),
        normalizeKotlinIdentifierPath(match[2]),
      );
      lineIndex = statement.endIndex;
    }
  }
  return aliases;
}

function collectKotlinPackageName(text, ignoredRanges = []) {
  const packagePattern = new RegExp(
    `^package\\s+(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*)\\s*$`,
    "u",
  );
  for (const line of kotlinSourceLines(text, ignoredRanges)) {
    const match = packagePattern.exec(normalizeKotlinQualifiedPathDots(line));
    if (match) {
      return normalizeKotlinIdentifierPath(match[1]);
    }
  }
  return undefined;
}

function collectKotlinConstantImports(text, ignoredRanges = []) {
  const imports = [];
  const importPattern = new RegExp(
    `^import\\s+(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*(?:\\.\\*)?)(?:\\s+as\\s+(${KOTLIN_IDENTIFIER_PATTERN}))?\\s*$`,
    "u",
  );
  const lines = kotlinSourceLines(text, ignoredRanges);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const importStatement = readKotlinImportStatement(lines, lineIndex, importPattern);
    const match = importPattern.exec(normalizeKotlinImportStatementForMatch(importStatement.statement));
    if (!match) {
      continue;
    }

    if (match[1].endsWith(".*")) {
      imports.push({
        wildcardPrefix: normalizeKotlinIdentifierPath(match[1].slice(0, -2)),
      });
      lineIndex = importStatement.endIndex;
      continue;
    }

    const importedName = normalizeKotlinIdentifierPath(match[1]);
    const importedParts = importedName.split(".");
    const exposedName = match[2] === undefined
      ? importedParts[importedParts.length - 1]
      : normalizeKotlinIdentifier(match[2]);
    imports.push({ exposedName, importedName });
    lineIndex = importStatement.endIndex;
  }
  return imports;
}

function resolveKotlinConstTypeName(typeName, typeAliases, seen = new Set()) {
  if (typeName === undefined) {
    return undefined;
  }
  const normalizedName = normalizeKotlinIdentifierPath(typeName);
  const canonicalName = canonicalKotlinTypeName(normalizedName);
  if (isKotlinConstType(canonicalName)) {
    return canonicalName;
  }
  if (!typeAliases || seen.has(normalizedName)) {
    return undefined;
  }
  const aliasedName = typeAliases.get(normalizedName);
  if (aliasedName === undefined) {
    return undefined;
  }
  seen.add(normalizedName);
  return resolveKotlinConstTypeName(aliasedName, typeAliases, seen);
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
  const constant = resolveKotlinConstantReference(trimmed, constants, constantTypes);
  if (constant !== undefined && canonicalKotlinTypeName(constant.typeName) === "String") {
    return constant.value;
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
  const constant = resolveKotlinConstantReference(trimmed, constants, constantTypes);
  if (constant !== undefined && canonicalKotlinTypeName(constant.typeName) === "Boolean") {
    return parseKotlinBooleanLiteralExpression(constant.value);
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
  const constant = resolveKotlinConstantReference(trimmed, constants, constantTypes);
  if (constant !== undefined && canonicalKotlinTypeName(constant.typeName) === "Char") {
    return constant.value;
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

function compareCharValues(left, operator, right) {
  if (operator === ">=") {
    return left >= right;
  }
  if (operator === "<=") {
    return left <= right;
  }
  if (operator === ">") {
    return left > right;
  }
  return left < right;
}

function evaluateCharComparisonExpression(expression, constants, constantTypes) {
  const trimmed = removeKotlinComments(expression).trim();
  const operators = [">=", "<=", ">", "<"];
  for (const operator of operators) {
    const parts = splitTopLevelToken(trimmed, operator);
    if (parts.length === 2) {
      const left = evaluateCharEqualityOperand(parts[0], constants, constantTypes);
      const right = evaluateCharEqualityOperand(parts[1], constants, constantTypes);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      return compareCharValues(left, operator, right) ? "true" : "false";
    }
    if (parts.length > 2) {
      return undefined;
    }
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
  const charComparison = evaluateCharComparisonExpression(trimmed, constants, constantTypes);
  if (charComparison !== undefined) {
    return charComparison;
  }

  const literal = parseKotlinBooleanLiteralExpression(trimmed);
  if (literal !== undefined) {
    return literal;
  }
  const constant = resolveKotlinConstantReference(trimmed, constants, constantTypes);
  if (constant !== undefined) {
    return parseKotlinBooleanLiteralExpression(constant.value);
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
  const constant = resolveKotlinConstantReference(trimmed, constants, constantTypes);
  if (constant !== undefined) {
    const typeName = canonicalKotlinTypeName(constant.typeName);
    if (typeName !== undefined && !isKotlinNumericType(typeName)) {
      return undefined;
    }
    return parseKotlinIntegerLiteralExpression(constant.value);
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
  const constant = resolveKotlinConstantReference(trimmed, constants, constantTypes);
  if (constant !== undefined && isKotlinNumericType(constant.typeName)) {
    return parseKotlinNumericLiteralExpression(constant.value);
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
  const constant = resolveKotlinConstantReference(name, constants);
  if (constant === undefined) {
    return undefined;
  }
  return `${result}${constant.value}`;
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

    const match = matchKotlinIdentifierStart(value.slice(index + 1));
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
  const constant = resolveKotlinConstantReference(trimmed, constants, constantTypes);
  if (constant !== undefined) {
    return constant.value;
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
  const constant = resolveKotlinConstantReference(trimmed, constants, constantTypes);
  if (constant !== undefined) {
    return canonicalKotlinTypeName(constant.typeName);
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
  const callPath = readKotlinIdentifierPath(trimmed, 0);
  if (!callPath) {
    return undefined;
  }
  const normalizedCallPath = normalizeKotlinIdentifierPath(callPath.path);
  if (
    normalizedCallPath !== callName
    && normalizedCallPath !== `kotlin.${callName}`
  ) {
    return undefined;
  }
  let openParen = skipWhitespaceAndComments(trimmed, callPath.end);
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
  const objectPattern = new RegExp(`\\bobject\\s+(${KOTLIN_IDENTIFIER_PATTERN})`, "gu");
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
          kind: "object",
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
  const typePattern = new RegExp(`\\b(?:class|interface)\\s+(${KOTLIN_IDENTIFIER_PATTERN})`, "gu");
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
          kind: "type",
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
    "gu",
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
          enclosingClassPath,
          kind: "companion",
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

function enclosingRanges(ranges, offset) {
  return ranges
    .filter((range) => offset >= range.start && offset < range.end)
    .sort((left, right) => left.start - right.start);
}

function classScopeMap(classRanges) {
  const scopes = new Map();
  for (const range of classRanges) {
    for (const path of enclosingObjectPaths(classRanges, range.start)) {
      if (path.length > 0) {
        scopes.set(pathText(path), {
          end: range.end,
          start: range.start,
        });
      }
    }
  }
  return scopes;
}

function addConstantVisibility(visibility, name, scope) {
  if (name.includes(".")) {
    return undefined;
  }
  const scopes = visibility.get(name) || [];
  const entry = scope === undefined ? { global: true } : { ...scope };
  scopes.push(entry);
  visibility.set(name, scopes);
  return entry;
}

function ensureConstantGloballyVisible(visibility, name, value, typeName) {
  if (name.includes(".")) {
    return false;
  }
  const scopes = visibility.get(name) || [];
  if (scopes.some((scope) => scope.global)) {
    return false;
  }
  const globalScope = { global: true };
  if (value !== undefined) {
    globalScope.value = value;
  }
  if (typeName !== undefined) {
    globalScope.typeName = typeName;
  }
  scopes.push(globalScope);
  visibility.set(name, scopes);
  return true;
}

function removeConstantGlobalVisibility(visibility, name) {
  if (name.includes(".")) {
    return false;
  }
  const scopes = visibility.get(name);
  if (scopes === undefined) {
    return false;
  }
  const localScopes = scopes.filter((scope) => !scope.global);
  if (localScopes.length === scopes.length) {
    return false;
  }
  if (localScopes.length === 0) {
    visibility.delete(name);
  } else {
    visibility.set(name, localScopes);
  }
  return true;
}

function hasGloballyVisibleConstant(visibility, name) {
  const scopes = visibility.get(name) || [];
  return scopes.some((scope) => scope.global);
}

function setConstantVisibilityEntryValues(entries, value, typeName) {
  for (const entry of entries) {
    entry.value = value;
    if (typeName !== undefined) {
      entry.typeName = typeName;
    }
  }
}

function constantSimpleVisibilityScopes(declarationOffset, objectRanges, classesByPath) {
  const objectScopes = enclosingRanges(objectRanges, declarationOffset);
  if (objectScopes.length === 0) {
    return [{ global: true }];
  }

  const innermostObject = objectScopes[objectScopes.length - 1];
  if (innermostObject.kind === "companion") {
    const classScope = classesByPath.get(pathText(innermostObject.enclosingClassPath || []));
    return [classScope || { end: innermostObject.end, start: innermostObject.start }];
  }

  return [{ end: innermostObject.end, start: innermostObject.start }];
}

function isConstantScopeVisibleAtOffset(scope, offset) {
  return scope.global || (offset >= scope.start && offset < scope.end);
}

function constantScopeSpecificity(scope) {
  if (scope.global) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(0, scope.end - scope.start);
}

function visibleConstantScopeAtOffset(scopes, offset) {
  const visibleScopes = scopes
    .filter((scope) => isConstantScopeVisibleAtOffset(scope, offset))
    .sort((left, right) => constantScopeSpecificity(left) - constantScopeSpecificity(right));
  return visibleScopes[0];
}

function isConstantVisibleAtOffset(name, visibility, offset) {
  if (name.includes(".") || visibility === undefined) {
    return true;
  }
  const scopes = visibility.get(name);
  if (scopes === undefined) {
    return true;
  }
  return visibleConstantScopeAtOffset(scopes, offset) !== undefined;
}

function constantsVisibleAtOffset(constants, constantTypes, visibility, offset) {
  if (visibility === undefined || offset === undefined) {
    return { constants, constantTypes };
  }

  const visibleConstants = new Map();
  const visibleTypes = new Map();
  for (const [name, value] of constants) {
    if (!isConstantVisibleAtOffset(name, visibility, offset)) {
      continue;
    }

    const scope = name.includes(".") ? undefined : visibleConstantScopeAtOffset(visibility.get(name) || [], offset);
    const visibleValue = scope && Object.prototype.hasOwnProperty.call(scope, "value")
      ? scope.value
      : value;
    visibleConstants.set(name, visibleValue);
    if (scope && Object.prototype.hasOwnProperty.call(scope, "typeName")) {
      visibleTypes.set(name, scope.typeName);
    } else if (constantTypes && constantTypes.has(name)) {
      visibleTypes.set(name, constantTypes.get(name));
    }
  }
  return {
    constants: visibleConstants,
    constantTypes: visibleTypes,
  };
}

function addMissingConstants(constants, constantTypes, additions, additionTypes) {
  let changed = false;
  for (const [name, value] of additions) {
    if (constants.has(name)) {
      continue;
    }
    constants.set(name, value);
    if (additionTypes && additionTypes.has(name)) {
      constantTypes.set(name, additionTypes.get(name));
    }
    changed = true;
  }
  return changed;
}

function addPackageQualifiedConstantNames(names, packageName, declarationName, objectPaths, classPaths) {
  if (packageName === undefined) {
    return;
  }

  const hasObjectPath = objectPaths.some((objectPath) => objectPath.length > 0);
  const effectiveClassPaths = classPaths.filter((classPath) => classPath.length > 0);
  const namesToQualify = new Set();
  if (!hasObjectPath && effectiveClassPaths.length === 0) {
    namesToQualify.add(declarationName);
  }
  for (const name of names) {
    if (!name.includes(".")) {
      continue;
    }
    if (
      effectiveClassPaths.length === 0
      || effectiveClassPaths.some((classPath) => pathHasPrefix(name.split("."), classPath))
    ) {
      namesToQualify.add(name);
    }
  }

  for (const name of namesToQualify) {
    names.add(`${packageName}.${name}`);
  }
}

function applyKotlinNamedConstantImport(
  constants,
  constantTypes,
  constantVisibility,
  exposedName,
  importedName,
) {
  return applyKotlinNamedConstantImportEntry(
    constants,
    constantTypes,
    constantVisibility,
    exposedName,
    importedName,
  ).changed;
}

function applyKotlinNamedConstantImportEntry(
  constants,
  constantTypes,
  constantVisibility,
  exposedName,
  importedName,
) {
  if (!constants.has(importedName)) {
    return { applied: false, changed: false };
  }

  let changed = false;
  const importedValue = constants.get(importedName);
  const importedTypeName = constantTypes.get(importedName);
  const hasExposedName = constants.has(exposedName);
  const hasExposedType = constantTypes.has(exposedName);
  if (!hasExposedName) {
    constants.set(exposedName, importedValue);
    changed = true;
  } else if (
    constants.get(exposedName) !== importedValue
    && hasGloballyVisibleConstant(constantVisibility, exposedName)
  ) {
    return { applied: false, changed: false };
  }

  let ownsType = false;
  if (!hasExposedName && importedTypeName !== undefined && !hasExposedType) {
    constantTypes.set(exposedName, importedTypeName);
    changed = true;
    ownsType = true;
  }
  const ownsVisibility = ensureConstantGloballyVisible(
    constantVisibility,
    exposedName,
    importedValue,
    importedTypeName,
  );
  if (ownsVisibility) {
    changed = true;
  }
  return {
    applied: true,
    changed,
    importedTypeName,
    importedValue,
    ownsType,
    ownsValue: !hasExposedName,
    ownsVisibility,
  };
}

function collectKotlinNamedConstantImportCandidates(constants, constantImports) {
  const candidates = new Map();
  const constantNames = Array.from(constants.keys());

  for (const { exposedName, importedName, wildcardPrefix } of constantImports) {
    if (wildcardPrefix !== undefined) {
      continue;
    }

    if (constants.has(importedName)) {
      const importedNames = candidates.get(exposedName) || [];
      importedNames.push(importedName);
      candidates.set(exposedName, importedNames);
    }

    const importedPrefix = `${importedName}.`;
    for (const constantName of constantNames) {
      if (!constantName.startsWith(importedPrefix)) {
        continue;
      }
      const suffix = constantName.slice(importedPrefix.length);
      if (suffix.length === 0) {
        continue;
      }
      const prefixedExposedName = `${exposedName}.${suffix}`;
      const importedNames = candidates.get(prefixedExposedName) || [];
      importedNames.push(constantName);
      candidates.set(prefixedExposedName, importedNames);
    }
  }

  return candidates;
}

function findUnambiguousKotlinNamedConstantImport(candidateNames) {
  const uniqueCandidateNames = [...new Set(candidateNames)];
  if (uniqueCandidateNames.length !== 1) {
    return undefined;
  }

  return uniqueCandidateNames[0];
}

function removeKotlinNamedConstantImport(
  constants,
  constantTypes,
  constantVisibility,
  namedImportState,
  exposedName,
) {
  const previousImport = namedImportState.get(exposedName);
  if (previousImport === undefined) {
    return false;
  }

  let changed = false;
  if (previousImport.ownsValue && constants.get(exposedName) === previousImport.value) {
    constants.delete(exposedName);
    changed = true;
  }
  if (
    previousImport.ownsType
    && previousImport.typeName !== undefined
    && constantTypes.get(exposedName) === previousImport.typeName
  ) {
    constantTypes.delete(exposedName);
    changed = true;
  }
  if (
    previousImport.ownsVisibility
    && removeConstantGlobalVisibility(constantVisibility, exposedName)
  ) {
    changed = true;
  }
  namedImportState.delete(exposedName);
  return changed;
}

function recordKotlinNamedConstantImport(
  namedImportState,
  exposedName,
  importedName,
  application,
) {
  if (!application.ownsValue && !application.ownsType && !application.ownsVisibility) {
    return;
  }
  namedImportState.set(exposedName, {
    importedName,
    ownsType: application.ownsType,
    ownsValue: application.ownsValue,
    ownsVisibility: application.ownsVisibility,
    typeName: application.importedTypeName,
    value: application.importedValue,
  });
}

function collectKotlinWildcardConstantImportCandidates(
  constants,
  constantVisibility,
  constantImports,
  wildcardImportState,
) {
  const candidates = new Map();
  const constantNames = Array.from(constants.keys());

  for (const { wildcardPrefix } of constantImports) {
    if (wildcardPrefix === undefined) {
      continue;
    }

    const prefix = `${wildcardPrefix}.`;
    for (const candidateName of constantNames) {
      if (!candidateName.startsWith(prefix)) {
        continue;
      }

      const wildcardName = candidateName.slice(prefix.length);
      if (wildcardName.length === 0) {
        continue;
      }
      if (
        !wildcardImportState.has(wildcardName)
        && hasGloballyVisibleConstant(constantVisibility, wildcardName)
      ) {
        continue;
      }

      const importedNames = candidates.get(wildcardName) || [];
      importedNames.push(candidateName);
      candidates.set(wildcardName, importedNames);
    }
  }

  return candidates;
}

function findUnambiguousKotlinWildcardConstantImport(constants, constantTypes, candidateNames) {
  const uniqueCandidateNames = [...new Set(candidateNames)];
  if (uniqueCandidateNames.length !== 1) {
    return undefined;
  }

  return uniqueCandidateNames[0];
}

function removeKotlinWildcardConstantImport(
  constants,
  constantTypes,
  constantVisibility,
  wildcardImportState,
  exposedName,
) {
  const previousImport = wildcardImportState.get(exposedName);
  if (previousImport === undefined) {
    return false;
  }

  let changed = false;
  if (constants.get(exposedName) === previousImport.value) {
    constants.delete(exposedName);
    changed = true;
  }
  if (
    previousImport.typeName !== undefined
    && constantTypes.get(exposedName) === previousImport.typeName
  ) {
    constantTypes.delete(exposedName);
    changed = true;
  }
  if (removeConstantGlobalVisibility(constantVisibility, exposedName)) {
    changed = true;
  }
  wildcardImportState.delete(exposedName);
  return changed;
}

function recordKotlinWildcardConstantImport(constants, constantTypes, wildcardImportState, exposedName) {
  wildcardImportState.set(exposedName, {
    typeName: constantTypes.get(exposedName),
    value: constants.get(exposedName),
  });
}

function applyKotlinWildcardConstantImports(
  constants,
  constantTypes,
  constantVisibility,
  constantImports,
  wildcardImportState,
) {
  let changed = false;
  const candidates = collectKotlinWildcardConstantImportCandidates(
    constants,
    constantVisibility,
    constantImports,
    wildcardImportState,
  );

  for (const [wildcardName, candidateNames] of candidates) {
    const importedName = findUnambiguousKotlinWildcardConstantImport(
      constants,
      constantTypes,
      candidateNames,
    );
    if (importedName === undefined) {
      if (removeKotlinWildcardConstantImport(
        constants,
        constantTypes,
        constantVisibility,
        wildcardImportState,
        wildcardName,
      )) {
        changed = true;
      }
      continue;
    }
    const hadWildcardImport = wildcardImportState.has(wildcardName);
    const appliedWildcardImport = applyKotlinNamedConstantImport(
      constants,
      constantTypes,
      constantVisibility,
      wildcardName,
      importedName,
    );
    if (appliedWildcardImport) {
      changed = true;
    }
    if (appliedWildcardImport || hadWildcardImport) {
      recordKotlinWildcardConstantImport(constants, constantTypes, wildcardImportState, wildcardName);
    }
  }

  return changed;
}

function applyKotlinNamedConstantImports(
  constants,
  constantTypes,
  constantVisibility,
  constantImports,
  namedImportState,
  wildcardImportState,
) {
  let changed = false;
  const candidates = collectKotlinNamedConstantImportCandidates(constants, constantImports);

  for (const [exposedName, candidateNames] of candidates) {
    const importedName = findUnambiguousKotlinNamedConstantImport(candidateNames);
    if (importedName === undefined) {
      if (removeKotlinNamedConstantImport(
        constants,
        constantTypes,
        constantVisibility,
        namedImportState,
        exposedName,
      )) {
        changed = true;
      }
      if (removeKotlinWildcardConstantImport(
        constants,
        constantTypes,
        constantVisibility,
        wildcardImportState,
        exposedName,
      )) {
        changed = true;
      }
      continue;
    }

    const previousImport = namedImportState.get(exposedName);
    if (
      previousImport !== undefined
      && previousImport.importedName !== importedName
      && removeKotlinNamedConstantImport(
        constants,
        constantTypes,
        constantVisibility,
        namedImportState,
        exposedName,
      )
    ) {
      changed = true;
    }
    if (removeKotlinWildcardConstantImport(
      constants,
      constantTypes,
      constantVisibility,
      wildcardImportState,
      exposedName,
    )) {
      changed = true;
    }

    const application = applyKotlinNamedConstantImportEntry(
      constants,
      constantTypes,
      constantVisibility,
      exposedName,
      importedName,
    );
    if (application.changed) {
      changed = true;
    }
    if (application.applied && !namedImportState.has(exposedName)) {
      recordKotlinNamedConstantImport(
        namedImportState,
        exposedName,
        importedName,
        application,
      );
    }
  }

  return changed;
}

function applyKotlinConstantImports(
  constants,
  constantTypes,
  constantVisibility,
  constantImports,
  namedImportState,
  wildcardImportState,
) {
  let changed = false;
  if (applyKotlinNamedConstantImports(
    constants,
    constantTypes,
    constantVisibility,
    constantImports,
    namedImportState,
    wildcardImportState,
  )) {
    changed = true;
  }
  if (applyKotlinWildcardConstantImports(
    constants,
    constantTypes,
    constantVisibility,
    constantImports,
    wildcardImportState,
  )) {
    changed = true;
  }
  return changed;
}

function readKotlinConstDeclaration(text, constIndex, typeAliases = new Map()) {
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

  const nameMatch = matchKotlinIdentifierStart(text.slice(index));
  if (!nameMatch) {
    return undefined;
  }
  const name = nameMatch[0];
  index = skipWhitespaceAndComments(text, index + name.length);

  let typeName;
  if (text[index] === ":") {
    index = skipWhitespaceAndComments(text, index + 1);
    const typeReference = readKotlinIdentifierPath(text, index);
    if (typeReference === undefined) {
      return undefined;
    }
    typeName = resolveKotlinConstTypeName(typeReference.path, typeAliases);
    if (typeName === undefined) {
      return undefined;
    }
    index = skipWhitespaceAndComments(text, typeReference.end);
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

function collectStringConstants(text, externalConstants = {}) {
  const constants = new Map(externalConstants.constants || []);
  const constantTypes = new Map(externalConstants.constantTypes || []);
  const samePackageConstants = new Map(externalConstants.samePackageConstants || []);
  const samePackageConstantTypes = new Map(externalConstants.samePackageConstantTypes || []);
  const constantVisibility = new Map();
  const expressions = [];
  const ignoredRanges = collectIgnoredKotlinRanges(text);
  const classRanges = collectNamedTypeRanges(text, ignoredRanges);
  const objectRanges = [
    ...collectObjectRanges(text, ignoredRanges),
    ...collectCompanionObjectRanges(text, ignoredRanges, classRanges),
  ];
  const classesByPath = classScopeMap(classRanges);
  const typeAliases = collectKotlinTypeAliases(text, ignoredRanges);
  const packageName = collectKotlinPackageName(text, ignoredRanges);
  const constantImports = collectKotlinConstantImports(text, ignoredRanges);
  const namedImportState = new Map();
  const wildcardImportState = new Map();
  const pattern = /\bconst\b/g;
  let match = pattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = pattern.exec(text);
      continue;
    }

    const declaration = readKotlinConstDeclaration(text, match.index, typeAliases);
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
    addPackageQualifiedConstantNames(
      names,
      packageName,
      declaration.name,
      objectPaths,
      classPaths,
    );
    const simpleScopes = constantSimpleVisibilityScopes(
      match.index,
      objectRanges,
      classesByPath,
    );
    const simpleVisibilityEntries = [];
    for (const scope of simpleScopes) {
      const visibilityEntry = addConstantVisibility(constantVisibility, declaration.name, scope);
      if (visibilityEntry !== undefined) {
        simpleVisibilityEntries.push(visibilityEntry);
      }
    }
    expressions.push({
      expression: text.slice(expressionStart, expressionEnd),
      names: [...names],
      offset: expressionStart,
      simpleVisibilityEntries,
      typeName: declaration.typeName,
    });
    pattern.lastIndex = expressionEnd;
    match = pattern.exec(text);
  }

  let changed = true;
  while (changed) {
    changed = applyKotlinConstantImports(
      constants,
      constantTypes,
      constantVisibility,
      constantImports,
      namedImportState,
      wildcardImportState,
    );
    for (const { expression, names, offset, simpleVisibilityEntries, typeName } of expressions) {
      if (names.every((name) => constants.has(name))) {
        continue;
      }
      const visible = constantsVisibleAtOffset(constants, constantTypes, constantVisibility, offset);
      addMissingConstants(
        visible.constants,
        visible.constantTypes,
        samePackageConstants,
        samePackageConstantTypes,
      );
      const value = evaluateStringExpression(expression, visible.constants, visible.constantTypes);
      if (value !== undefined) {
        const resolvedType = typeName
          || inferKotlinConstantType(expression, visible.constants, visible.constantTypes);
        for (const name of names) {
          if (!constants.has(name)) {
            constants.set(name, value);
            if (resolvedType !== undefined) {
              constantTypes.set(name, resolvedType);
            }
          }
        }
        setConstantVisibilityEntryValues(simpleVisibilityEntries, value, resolvedType);
        changed = true;
      }
    }
  }
  addMissingConstants(constants, constantTypes, samePackageConstants, samePackageConstantTypes);

  return { constants, constantTypes, constantVisibility };
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

function normalizeStepTemplate(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const dynamicStart = findDynamicParameterStart(text, index);
    const staticStart = findStaticParameterStart(text, index);
    const parameter = findNextStepParameter(dynamicStart, staticStart);
    if (!parameter) {
      result += text.slice(index);
      break;
    }

    const closeIndex = parameter.type === "dynamic"
      ? findDynamicParameterEnd(text, parameter.openIndex)
      : findStaticParameterEnd(text, parameter.openIndex);
    if (closeIndex === -1) {
      result += text.slice(index);
      break;
    }

    result += `${text.slice(index, parameter.openIndex)}{}`;
    index = closeIndex + 1;
  }
  return result.trim().normalize("NFC");
}

function isInlineTableLine(line) {
  return line.trimStart().startsWith("|");
}

function conceptHashHeading(rawLine, lineNumber) {
  const match = /^(#+)([ \t]*)(.*?)[ \t]*$/.exec(rawLine);
  if (!match) {
    return undefined;
  }
  const textStart = match[1].length + match[2].length;
  const text = rawLine.slice(textStart).trimEnd();
  if (!text) {
    return undefined;
  }
  return {
    end: { line: lineNumber, character: textStart + text.length },
    normalized: normalizeStepTemplate(text),
    start: { line: lineNumber, character: textStart },
    text,
  };
}

function conceptLegacyHeading(lines, lineNumber) {
  if (lineNumber >= lines.length - 1) {
    return undefined;
  }
  const rawLine = lines[lineNumber].replace(/\r$/, "");
  const underline = lines[lineNumber + 1].replace(/\r$/, "");
  if (!rawLine || rawLine.search(/\S/) !== 0 || !/^=+\s*$/.test(underline)) {
    return undefined;
  }
  const text = rawLine.trimEnd();
  if (!text) {
    return undefined;
  }
  return {
    end: { line: lineNumber, character: text.length },
    normalized: normalizeStepTemplate(text),
    start: { line: lineNumber, character: 0 },
    text,
  };
}

function findConceptHeadings(text) {
  const headings = [];
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line += 1) {
    const rawLine = lines[line].replace(/\r$/, "");
    const hashHeading = conceptHashHeading(rawLine, line);
    if (hashHeading) {
      headings.push(hashHeading);
      continue;
    }
    const legacyHeading = conceptLegacyHeading(lines, line);
    if (legacyHeading) {
      headings.push(legacyHeading);
    }
  }
  return headings;
}

function findGaugeSteps(text) {
  const entries = [];
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line += 1) {
    const rawLine = lines[line].replace(/\r$/, "");
    const marker = rawLine.search(/\S/);
    if (marker === -1 || rawLine[marker] !== "*") {
      continue;
    }

    let stepText = rawLine.slice(marker + 1).trim();
    if (stepText && lines[line + 1] !== undefined && isInlineTableLine(lines[line + 1])) {
      stepText = `${stepText} <table>`;
    }
    entries.push({
      end: { line, character: rawLine.length },
      marker,
      normalized: stepText ? normalizeStepTemplate(stepText) : undefined,
      start: { line, character: marker },
      text: stepText,
    });
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
  return KOTLIN_BARE_IDENTIFIER_REGEXP.test(name) || /^`[^`\r\n]+`$/.test(name);
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
      || isKotlinIdentifierStartCharacter(char)
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
        const bodyStart = skipWhitespaceAndComments(text, closeParen + 1);
        return {
          declarationEnd: bodyStart < text.length ? bodyStart : closeParen + 1,
          declarationStart: match.index,
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
    declarationEnd: headerEnd,
    declarationStart: startIndex,
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
        declarationEnd: startIndex + accessor[0].length,
        declarationStart: startIndex,
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
    declarationEnd: closeParen + 1,
    declarationStart: startIndex,
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
  const target = matchKotlinIdentifierStart(text.slice(index));
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

  const name = readKotlinIdentifierPath(text, index);
  if (!name) {
    return undefined;
  }

  const annotationName = name.path;
  index = skipWhitespaceAndComments(text, name.end);
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

function startsKotlinTypeAliasDeclaration(line) {
  return /^typealias(?:\s|$)/.test(stripKotlinTypeAliasPreamble(line));
}

function readKotlinTypeAliasStatement(lines, startIndex, typeAliasPattern) {
  let statement = lines[startIndex];
  if (!startsKotlinTypeAliasDeclaration(statement)) {
    return { endIndex: startIndex, statement };
  }

  for (let index = startIndex; index < lines.length; index += 1) {
    if (typeAliasPattern.test(normalizeKotlinTypeAliasStatementForMatch(statement))) {
      return { endIndex: index, statement };
    }
    if (index + 1 >= lines.length || startsKotlinTypeAliasDeclaration(lines[index + 1])) {
      return { endIndex: index, statement };
    }
    statement = `${statement} ${lines[index + 1]}`;
  }
  return { endIndex: lines.length - 1, statement };
}

function recordNamedStepAnnotationImport(named, ambiguousNamed, exposedName, importedName) {
  if (ambiguousNamed.has(exposedName)) {
    return;
  }
  if (!named.has(exposedName)) {
    named.set(exposedName, importedName);
    return;
  }
  if (named.get(exposedName) === importedName) {
    return;
  }
  named.delete(exposedName);
  ambiguousNamed.add(exposedName);
}

function recordStepAnnotationTypeAlias(named, ambiguousNamed, exposedName, targetName) {
  ambiguousNamed.delete(exposedName);
  named.set(exposedName, targetName);
}

function wildcardStepTypeAliasExposedName(importedName, wildcardPrefix) {
  const prefix = `${wildcardPrefix}.`;
  if (!importedName.startsWith(prefix)) {
    return undefined;
  }
  const exposedName = importedName.slice(prefix.length);
  return exposedName.includes(".") ? undefined : exposedName;
}

function collectWildcardStepTypeAliasImportCandidates(wildcards, externalStepAliases) {
  const candidates = new Map();
  for (const wildcardPrefix of wildcards) {
    for (const importedName of externalStepAliases.keys()) {
      const exposedName = wildcardStepTypeAliasExposedName(importedName, wildcardPrefix);
      if (exposedName === undefined) {
        continue;
      }
      if (!candidates.has(exposedName)) {
        candidates.set(exposedName, new Set());
      }
      candidates.get(exposedName).add(importedName);
    }
  }
  return candidates;
}

function applyWildcardStepTypeAliasImports(named, ambiguousNamed, wildcards, externalStepAliases) {
  if (wildcards.size === 0 || externalStepAliases.size === 0) {
    return;
  }
  const candidates = collectWildcardStepTypeAliasImportCandidates(wildcards, externalStepAliases);
  for (const [exposedName, importedNames] of candidates) {
    if (named.has(exposedName) || ambiguousNamed.has(exposedName)) {
      continue;
    }
    if (importedNames.size !== 1) {
      ambiguousNamed.add(exposedName);
      continue;
    }
    const [importedName] = importedNames;
    named.set(exposedName, externalStepAliases.get(importedName));
  }
}

function applySamePackageStepTypeAliasImports(named, ambiguousNamed, externalStepAliases) {
  for (const [exposedName, targetName] of externalStepAliases) {
    if (exposedName.includes(".") || named.has(exposedName) || ambiguousNamed.has(exposedName)) {
      continue;
    }
    named.set(exposedName, targetName);
  }
}

function stepAnnotationImports(
  text,
  ignoredRanges = [],
  externalStepAliases = new Map(),
  samePackageClassifiers = new Set(),
) {
  const ambiguousNamed = new Set();
  const named = new Map();
  const wildcards = new Set();
  const importPattern = new RegExp(
    `^import\\s+(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*(?:\\.\\*)?)(?:\\s+as\\s+(${KOTLIN_IDENTIFIER_PATTERN}))?\\s*$`,
    "u",
  );
  const typeAliasPattern = new RegExp(
    `^typealias\\s+(${KOTLIN_IDENTIFIER_PATTERN})\\s*=\\s*(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*)\\s*$`,
    "u",
  );
  const lines = kotlinSourceLines(text, ignoredRanges);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const importStatement = readKotlinImportStatement(lines, lineIndex, importPattern);
    let match = importPattern.exec(normalizeKotlinImportStatementForMatch(importStatement.statement));
    if (match) {
      const importedName = normalizeKotlinIdentifierPath(match[1]);
      const alias = match[2] === undefined ? undefined : normalizeKotlinIdentifier(match[2]);
      if (match[1].endsWith(".*")) {
        wildcards.add(importedName.slice(0, -2));
        lineIndex = importStatement.endIndex;
        continue;
      }

      const importedParts = importedName.split(".");
      const exposedName = alias || importedParts[importedParts.length - 1];
      if (importedParts[importedParts.length - 1] === "Step") {
        recordNamedStepAnnotationImport(named, ambiguousNamed, exposedName, importedName);
      } else if (externalStepAliases.has(importedName)) {
        recordNamedStepAnnotationImport(
          named,
          ambiguousNamed,
          exposedName,
          externalStepAliases.get(importedName),
        );
      }
      lineIndex = importStatement.endIndex;
      continue;
    }

    const statement = readKotlinTypeAliasStatement(lines, lineIndex, typeAliasPattern);
    match = typeAliasPattern.exec(normalizeKotlinTypeAliasStatementForMatch(statement.statement));
    if (match) {
      recordStepAnnotationTypeAlias(
        named,
        ambiguousNamed,
        normalizeKotlinIdentifier(match[1]),
        normalizeKotlinIdentifierPath(match[2]),
      );
      lineIndex = statement.endIndex;
    }
  }
  applyWildcardStepTypeAliasImports(named, ambiguousNamed, wildcards, externalStepAliases);
  applySamePackageStepTypeAliasImports(named, ambiguousNamed, externalStepAliases);
  return {
    ambiguousNamed,
    named,
    samePackageClassifiers,
    wildcards,
  };
}

function collectKotlinStepTypeAliasDeclarations(text, ignoredRanges = []) {
  const aliases = new Map();
  const typeAliasPattern = new RegExp(
    `^typealias\\s+(${KOTLIN_IDENTIFIER_PATTERN})\\s*=\\s*(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*)\\s*$`,
    "u",
  );
  const lines = kotlinSourceLines(text, ignoredRanges);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const statement = readKotlinTypeAliasStatement(lines, lineIndex, typeAliasPattern);
    const match = typeAliasPattern.exec(normalizeKotlinTypeAliasStatementForMatch(statement.statement));
    if (match) {
      aliases.set(
        normalizeKotlinIdentifier(match[1]),
        normalizeKotlinIdentifierPath(match[2]),
      );
      lineIndex = statement.endIndex;
    }
  }
  return aliases;
}

function collectPackageQualifiedTypeAliasDeclarationNames(text, packageName, ignoredRanges = []) {
  const names = [];
  const typeAliasPattern = new RegExp(
    `^typealias\\s+(${KOTLIN_IDENTIFIER_PATTERN})\\s*=\\s*(${KOTLIN_IDENTIFIER_PATTERN}(?:\\.${KOTLIN_IDENTIFIER_PATTERN})*)\\s*$`,
    "u",
  );
  const packagePrefix = `${packageName}.`;
  const lines = kotlinSourceLines(text, ignoredRanges);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const statement = readKotlinTypeAliasStatement(lines, lineIndex, typeAliasPattern);
    const match = typeAliasPattern.exec(normalizeKotlinTypeAliasStatementForMatch(statement.statement));
    if (match) {
      names.push(`${packagePrefix}${normalizeKotlinIdentifier(match[1])}`);
      lineIndex = statement.endIndex;
    }
  }
  return names;
}

function resolvePackageQualifiedStepTypeAliasTarget(aliasName, stepImports) {
  const resolvedName = resolveStepAnnotationTarget(
    aliasName,
    stepImports.named,
    stepImports.samePackageClassifiers,
  );
  if (resolvedName === aliasName) {
    return undefined;
  }
  if (resolvedName.includes(".")) {
    return resolvedName;
  }
  if (
    stepImports.samePackageClassifiers
    && stepImports.samePackageClassifiers.has(resolvedName)
  ) {
    return undefined;
  }
  if (resolvedName === "Step" && stepImports.wildcards.size === 1) {
    return `${[...stepImports.wildcards][0]}.Step`;
  }
  return undefined;
}

function collectPackageQualifiedStepTypeAliases(
  text,
  packageName,
  ignoredRanges = [],
  externalStepAliases = new Map(),
  samePackageClassifiers = new Set(),
) {
  const aliases = new Map();
  const stepImports = stepAnnotationImports(
    text,
    ignoredRanges,
    externalStepAliases,
    samePackageClassifiers,
  );
  const declarations = collectKotlinStepTypeAliasDeclarations(text, ignoredRanges);
  const packagePrefix = `${packageName}.`;

  for (const aliasName of declarations.keys()) {
    if (stepImports.ambiguousNamed.has(aliasName)) {
      continue;
    }
    const targetName = resolvePackageQualifiedStepTypeAliasTarget(aliasName, stepImports);
    if (targetName !== undefined) {
      aliases.set(`${packagePrefix}${aliasName}`, targetName);
    }
  }
  return aliases;
}

function stepAnnotationClassifierNames(stepImports, localClassifierNames = new Set()) {
  const names = new Set(localClassifierNames);
  if (stepImports.samePackageClassifiers) {
    for (const name of stepImports.samePackageClassifiers) {
      names.add(name);
    }
  }
  return names;
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
    "gu",
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
    "gu",
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
    "gu",
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

function resolveStepAnnotationTarget(annotationName, namedImports, localClassifierNames = new Set(), seen = new Set()) {
  const normalizedName = normalizeKotlinIdentifierPath(annotationName);
  if (normalizedName === GAUGE_STEP_ANNOTATION) {
    return normalizedName;
  }
  if (!normalizedName.includes(".") && localClassifierNames.has(normalizedName)) {
    return normalizedName;
  }
  if (!namedImports.has(normalizedName) || seen.has(normalizedName)) {
    return normalizedName;
  }
  seen.add(normalizedName);
  return resolveStepAnnotationTarget(namedImports.get(normalizedName), namedImports, localClassifierNames, seen);
}

function isStepAnnotationAllowed(annotationName, stepImports, localClassifierNames = new Set()) {
  const normalizedName = normalizeKotlinIdentifierPath(annotationName);
  if (normalizedName === GAUGE_STEP_ANNOTATION) {
    return true;
  }
  if (normalizedName.includes(".")) {
    return false;
  }
  const classifierNames = stepAnnotationClassifierNames(stepImports, localClassifierNames);
  if (classifierNames.has(normalizedName)) {
    return false;
  }
  if (stepImports.ambiguousNamed && stepImports.ambiguousNamed.has(normalizedName)) {
    return false;
  }
  if (stepImports.named.has(normalizedName)) {
    const resolvedName = resolveStepAnnotationTarget(normalizedName, stepImports.named, classifierNames);
    if (!resolvedName.includes(".") && classifierNames.has(resolvedName)) {
      return false;
    }
    return resolvedName === GAUGE_STEP_ANNOTATION
      || (
        resolvedName === "Step"
        && stepImports.wildcards.size === 1
        && stepImports.wildcards.has(GAUGE_STEP_PACKAGE)
      );
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
  constantVisibility,
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
  const visible = constantsVisibleAtOffset(constants, constantTypes, constantVisibility, openParen);
  const aliases = extractStepAliases(
    text.slice(openParen + 1, closeParen),
    visible.constants,
    visible.constantTypes,
  );
  const method = findAttachedDeclaration(text, functionSearchStart(closeParen), ignoredRanges, annotationStart);
  if (aliases.length > 0 && method) {
    entries.push({
      aliases,
      annotationEnd: closeParen + 1,
      annotationStart,
      ...method,
    });
  }
}

function addGroupedStepFunctions(
  entries,
  text,
  constants,
  constantTypes,
  constantVisibility,
  ignoredRanges,
  stepImports,
  functionBodyRanges,
) {
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
    let annotationIndex = groupStart;
    while (annotationIndex < closeBracket) {
      annotationIndex = skipWhitespaceAndComments(text, annotationIndex);
      if (annotationIndex >= closeBracket) {
        break;
      }
      if (isInIgnoredRange(annotationIndex, ignoredRanges)) {
        annotationIndex += 1;
        continue;
      }
      const annotationName = readKotlinIdentifierPath(text, annotationIndex);
      if (!annotationName || annotationName.end > closeBracket) {
        annotationIndex += 1;
        continue;
      }
      const openParen = skipWhitespaceAndComments(text, annotationName.end);
      if (text[openParen] !== "(") {
        annotationIndex = Math.max(annotationName.end, annotationIndex + 1);
        continue;
      }
      const closeParen = findMatchingParen(text, openParen);
      if (closeParen === -1 || closeParen > closeBracket) {
        annotationIndex = openParen + 1;
        continue;
      }

      addStepFunctionEntry(
        entries,
        text,
        constants,
        constantTypes,
        constantVisibility,
        ignoredRanges,
        stepImports,
        functionBodyRanges,
        annotationName.path,
        openParen,
        () => closeBracket + 1,
        findAttachedDeclaration,
        groupMatch.index,
      );
      annotationIndex = closeParen + 1;
    }
    groupPattern.lastIndex = group.end;
    groupMatch = groupPattern.exec(text);
  }
}

function findStepFunctions(text, externalConstants) {
  const entries = [];
  const annotationPattern = /@/g;
  const { constants, constantTypes, constantVisibility } = collectStringConstants(text, externalConstants);
  const ignoredRanges = collectIgnoredKotlinRanges(text);
  const stepImports = stepAnnotationImports(
    text,
    ignoredRanges,
    externalConstants && externalConstants.stepAliases,
    externalConstants && externalConstants.samePackageClassifiers,
  );
  const functionBodyRanges = [
    ...collectFunctionBodyRanges(text, ignoredRanges),
    ...collectInitBlockBodyRanges(text, ignoredRanges),
    ...collectConstructorBodyRanges(text, ignoredRanges),
    ...collectPropertyAccessorBodyRanges(text, ignoredRanges),
    ...collectPropertyInitializerRanges(text, ignoredRanges),
  ];
  addGroupedStepFunctions(
    entries,
    text,
    constants,
    constantTypes,
    constantVisibility,
    ignoredRanges,
    stepImports,
    functionBodyRanges,
  );
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
      constantVisibility,
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

const JAVA_IDENTIFIER_PATTERN = "[A-Za-z_$][A-Za-z0-9_$]*";
const JAVA_IDENTIFIER_REGEXP = new RegExp(`^${JAVA_IDENTIFIER_PATTERN}`);
const JAVA_CONTROL_METHOD_NAMES = new Set([
  "catch",
  "for",
  "if",
  "new",
  "switch",
  "synchronized",
  "while",
]);
const JAVA_STEP_IMPORTS = {
  named: "named",
  wildcard: "wildcard",
};

function readJavaIdentifierPath(text, startIndex) {
  const segments = [];
  let index = startIndex;
  while (index < text.length) {
    const match = JAVA_IDENTIFIER_REGEXP.exec(text.slice(index));
    if (!match) {
      break;
    }
    segments.push(match[0]);
    index += match[0].length;
    const dotIndex = skipWhitespaceAndComments(text, index);
    if (text[dotIndex] !== ".") {
      break;
    }
    index = skipWhitespaceAndComments(text, dotIndex + 1);
  }
  if (segments.length === 0) {
    return undefined;
  }
  return {
    end: index,
    path: segments.join("."),
  };
}

function skipJavaAnnotation(text, startIndex) {
  if (text[startIndex] !== "@") {
    return startIndex;
  }
  const annotationName = readJavaIdentifierPath(text, startIndex + 1);
  if (!annotationName) {
    return startIndex;
  }
  let index = skipWhitespaceAndComments(text, annotationName.end);
  if (text[index] === "(") {
    const closeParen = findMatchingParen(text, index);
    if (closeParen === -1) {
      return text.length;
    }
    index = closeParen + 1;
  }
  return index;
}

function collectJavaStepImports(text, ignoredRanges = []) {
  const imports = new Set();
  const importPattern = /^\s*import\s+([^;]+);/gm;
  let match = importPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = importPattern.exec(text);
      continue;
    }
    const imported = match[1].trim().replace(/\s+/g, " ");
    if (imported.startsWith("static ")) {
      match = importPattern.exec(text);
      continue;
    }
    if (imported === GAUGE_STEP_ANNOTATION) {
      imports.add(JAVA_STEP_IMPORTS.named);
    } else if (imported === `${GAUGE_STEP_PACKAGE}.*`) {
      imports.add(JAVA_STEP_IMPORTS.wildcard);
    }
    match = importPattern.exec(text);
  }
  return imports;
}

function isJavaStepAnnotationAllowed(annotationName, stepImports) {
  if (annotationName === GAUGE_STEP_ANNOTATION) {
    return true;
  }
  return annotationName === "Step"
    && (
      stepImports.has(JAVA_STEP_IMPORTS.named)
      || stepImports.has(JAVA_STEP_IMPORTS.wildcard)
    );
}

function readJavaStringLiteral(text, startIndex) {
  if (text[startIndex] !== "\"") {
    return undefined;
  }
  let value = "";
  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      if (index + 1 >= text.length) {
        return undefined;
      }
      const escaped = text[index + 1];
      if (escaped === "n") {
        value += "\n";
      } else if (escaped === "r") {
        value += "\r";
      } else if (escaped === "t") {
        value += "\t";
      } else if (escaped === "b") {
        value += "\b";
      } else if (escaped === "f") {
        value += "\f";
      } else {
        value += escaped;
      }
      index += 1;
      continue;
    }
    if (char === "\"") {
      return {
        end: index + 1,
        value,
      };
    }
    value += char;
  }
  return undefined;
}

function normalizeJavaIdentifierPath(value) {
  return value.trim().replace(/\s*\.\s*/g, ".");
}

function collectJavaPackageName(text, ignoredRanges = []) {
  const packagePattern = /^\s*package\s+([^;]+);/gm;
  let match = packagePattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = packagePattern.exec(text);
      continue;
    }
    const packageName = normalizeJavaIdentifierPath(match[1]);
    if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(packageName)) {
      return packageName;
    }
    match = packagePattern.exec(text);
  }
  return undefined;
}

function collectJavaTypeRanges(text, ignoredRanges = []) {
  const ranges = [];
  const typePattern = /\b(class|interface|enum|record)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
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
          kind: match[1],
          name: match[2],
          start: bodyStart + 1,
        });
        typePattern.lastIndex = bodyStart + 1;
      }
    }
    match = typePattern.exec(text);
  }
  return ranges;
}

function enclosingJavaTypes(typeRanges, offset) {
  return typeRanges
    .filter((range) => offset >= range.start && offset < range.end)
    .sort((left, right) => left.start - right.start);
}

function enclosingJavaTypePath(typeRanges, offset) {
  return enclosingJavaTypes(typeRanges, offset).map((range) => range.name);
}

function javaStringLiteralTerm(text) {
  const trimmed = text.trim();
  const literal = readJavaStringLiteral(trimmed, 0);
  if (literal && literal.end === trimmed.length) {
    return literal.value;
  }
  return undefined;
}

function evaluateJavaStringExpression(expression, constants = new Map()) {
  const trimmed = removeKotlinComments(expression).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("(") && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evaluateJavaStringExpression(trimmed.slice(1, -1), constants);
  }

  const literal = javaStringLiteralTerm(trimmed);
  if (literal !== undefined) {
    return literal;
  }

  const reference = normalizeJavaIdentifierPath(trimmed);
  if (
    /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(reference)
    && constants.has(reference)
  ) {
    return constants.get(reference);
  }

  const parts = splitTopLevel(trimmed, "+").map((part) => part.trim());
  if (parts.length > 1) {
    const values = parts.map((part) => evaluateJavaStringExpression(part, constants));
    if (values.every((value) => value !== undefined)) {
      return values.join("");
    }
  }

  return undefined;
}

function collectJavaConstantImports(text, ignoredRanges = []) {
  const imports = {
    classImports: [],
    packageWildcards: [],
    staticImports: [],
    staticWildcards: [],
  };
  const importPattern = /^\s*import\s+(static\s+)?([^;]+);/gm;
  let match = importPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = importPattern.exec(text);
      continue;
    }

    const importedName = normalizeJavaIdentifierPath(match[2]);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\.\*)*$/.test(importedName)) {
      match = importPattern.exec(text);
      continue;
    }
    if (match[1]) {
      if (importedName.endsWith(".*")) {
        imports.staticWildcards.push(importedName.slice(0, -2));
      } else {
        const parts = importedName.split(".");
        imports.staticImports.push({
          exposedName: parts[parts.length - 1],
          importedName,
        });
      }
    } else if (importedName.endsWith(".*")) {
      imports.packageWildcards.push(importedName.slice(0, -2));
    } else {
      const parts = importedName.split(".");
      imports.classImports.push({
        exposedName: parts[parts.length - 1],
        importedName,
      });
    }
    match = importPattern.exec(text);
  }
  return imports;
}

function setImportedJavaConstant(constants, constantTypes, exposedName, importedName) {
  if (!constants.has(importedName)) {
    return false;
  }
  if (constants.has(exposedName)) {
    return false;
  }
  constants.set(exposedName, constants.get(importedName));
  if (constantTypes.has(importedName)) {
    constantTypes.set(exposedName, constantTypes.get(importedName));
  }
  return true;
}

function applyJavaClassConstantImports(constants, constantTypes, classImports) {
  let changed = false;
  const names = [...constants.keys()];
  for (const { exposedName, importedName } of classImports) {
    const prefix = `${importedName}.`;
    for (const name of names) {
      if (!name.startsWith(prefix)) {
        continue;
      }
      const suffix = name.slice(prefix.length);
      if (suffix && setImportedJavaConstant(constants, constantTypes, `${exposedName}.${suffix}`, name)) {
        changed = true;
      }
    }
  }
  return changed;
}

function applyJavaPackageWildcardConstantImports(constants, constantTypes, packageWildcards) {
  let changed = false;
  const names = [...constants.keys()];
  for (const packageName of packageWildcards) {
    const prefix = `${packageName}.`;
    for (const name of names) {
      if (!name.startsWith(prefix)) {
        continue;
      }
      const exposedName = name.slice(prefix.length);
      if (exposedName && setImportedJavaConstant(constants, constantTypes, exposedName, name)) {
        changed = true;
      }
    }
  }
  return changed;
}

function applyJavaStaticConstantImports(constants, constantTypes, staticImports) {
  let changed = false;
  for (const { exposedName, importedName } of staticImports) {
    if (setImportedJavaConstant(constants, constantTypes, exposedName, importedName)) {
      changed = true;
    }
  }
  return changed;
}

function applyJavaStaticWildcardConstantImports(constants, constantTypes, staticWildcards) {
  let changed = false;
  const names = [...constants.keys()];
  for (const importedName of staticWildcards) {
    const prefix = `${importedName}.`;
    for (const name of names) {
      if (!name.startsWith(prefix)) {
        continue;
      }
      const exposedName = name.slice(prefix.length);
      if (
        exposedName
        && !exposedName.includes(".")
        && setImportedJavaConstant(constants, constantTypes, exposedName, name)
      ) {
        changed = true;
      }
    }
  }
  return changed;
}

function applyJavaConstantImports(constants, constantTypes, imports) {
  let changed = false;
  if (applyJavaClassConstantImports(constants, constantTypes, imports.classImports)) {
    changed = true;
  }
  if (applyJavaPackageWildcardConstantImports(constants, constantTypes, imports.packageWildcards)) {
    changed = true;
  }
  if (applyJavaStaticConstantImports(constants, constantTypes, imports.staticImports)) {
    changed = true;
  }
  if (applyJavaStaticWildcardConstantImports(constants, constantTypes, imports.staticWildcards)) {
    changed = true;
  }
  return changed;
}

function collectJavaStringConstants(text, externalConstants = {}) {
  const constants = new Map(externalConstants.constants || []);
  const constantTypes = new Map(externalConstants.constantTypes || []);
  const samePackageConstants = new Map(externalConstants.samePackageConstants || []);
  const samePackageConstantTypes = new Map(externalConstants.samePackageConstantTypes || []);
  const ignoredRanges = collectIgnoredKotlinRanges(text);
  const packageName = collectJavaPackageName(text, ignoredRanges);
  const typeRanges = collectJavaTypeRanges(text, ignoredRanges);
  const declarations = [];
  const constantImports = collectJavaConstantImports(text, ignoredRanges);
  const pattern = /\b((?:(?:public|protected|private|static|final|transient|volatile)\s+)*)String\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  let match = pattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = pattern.exec(text);
      continue;
    }
    const enclosingTypes = enclosingJavaTypes(typeRanges, match.index);
    if (enclosingTypes.length === 0) {
      match = pattern.exec(text);
      continue;
    }
    const modifiers = new Set(match[1].trim().split(/\s+/).filter(Boolean));
    const inInterface = enclosingTypes[enclosingTypes.length - 1].kind === "interface";
    if (!inInterface && (!modifiers.has("static") || !modifiers.has("final"))) {
      match = pattern.exec(text);
      continue;
    }

    const name = match[2];
    const expressionStart = pattern.lastIndex;
    const expressionEnd = findConstExpressionEnd(text, expressionStart);
    const typePath = enclosingJavaTypePath(typeRanges, match.index);
    const names = new Set([name, `${typePath.join(".")}.${name}`]);
    if (packageName !== undefined) {
      names.add(`${packageName}.${typePath.join(".")}.${name}`);
    }
    declarations.push({
      expression: text.slice(expressionStart, expressionEnd),
      names: [...names],
    });
    pattern.lastIndex = expressionEnd;
    match = pattern.exec(text);
  }

  addMissingConstants(constants, constantTypes, samePackageConstants, samePackageConstantTypes);

  let changed = true;
  while (changed) {
    changed = applyJavaConstantImports(constants, constantTypes, constantImports);
    for (const { expression, names } of declarations) {
      if (names.every((name) => constants.has(name))) {
        continue;
      }
      const value = evaluateJavaStringExpression(expression, constants);
      if (value === undefined) {
        continue;
      }
      for (const name of names) {
        if (!constants.has(name)) {
          constants.set(name, value);
          constantTypes.set(name, "String");
          changed = true;
        }
      }
    }
  }
  addMissingConstants(constants, constantTypes, samePackageConstants, samePackageConstantTypes);
  applyJavaConstantImports(constants, constantTypes, constantImports);

  return { constants, constantTypes };
}

function evaluateJavaStepAliasExpression(expression, constants) {
  const trimmed = expression.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return splitTopLevelParameters(trimmed.slice(1, -1))
      .map((part) => evaluateJavaStringExpression(part, constants))
      .filter((value) => value !== undefined);
  }
  const value = evaluateJavaStringExpression(trimmed, constants);
  return value === undefined ? [] : [value];
}

function extractJavaStepAliases(annotationArgs, constants) {
  const args = splitTopLevelParameters(annotationArgs);
  const positionalExpressions = [];
  let valueExpression;

  for (const arg of args) {
    const equalsIndex = findTopLevelChar(arg, "=");
    if (equalsIndex === -1) {
      positionalExpressions.push(arg);
      continue;
    }
    const name = removeKotlinComments(arg.slice(0, equalsIndex)).trim();
    if (name === "value") {
      valueExpression = arg.slice(equalsIndex + 1);
      break;
    }
  }

  if (valueExpression !== undefined) {
    return evaluateJavaStepAliasExpression(valueExpression, constants);
  }

  return positionalExpressions.flatMap((expression) => (
    evaluateJavaStepAliasExpression(expression, constants)
  ));
}

function previousJavaIdentifier(text, endIndex) {
  let index = endIndex - 1;
  while (index >= 0 && /\s/.test(text[index])) {
    index -= 1;
  }
  const end = index + 1;
  while (index >= 0 && /[A-Za-z0-9_$]/.test(text[index])) {
    index -= 1;
  }
  const start = index + 1;
  if (start === end) {
    return undefined;
  }
  return {
    end,
    start,
    value: text.slice(start, end),
  };
}

function findNextJavaMethod(text, startIndex, ignoredRanges = []) {
  let searchStart = startIndex;
  while (searchStart < text.length) {
    searchStart = skipWhitespaceAndComments(text, searchStart);
    if (text[searchStart] !== "@") {
      break;
    }
    const next = skipJavaAnnotation(text, searchStart);
    if (next === searchStart) {
      return undefined;
    }
    searchStart = next;
  }

  for (let index = searchStart; index < text.length; index += 1) {
    if (isInIgnoredRange(index, ignoredRanges)) {
      continue;
    }
    const char = text[index];
    if (char === ";" || char === "{") {
      return undefined;
    }
    if (char !== "(") {
      continue;
    }
    const name = previousJavaIdentifier(text, index);
    if (!name || JAVA_CONTROL_METHOD_NAMES.has(name.value)) {
      continue;
    }
    const closeParen = findMatchingParen(text, index);
    if (closeParen === -1) {
      return undefined;
    }
    let declarationEnd = skipWhitespaceAndComments(text, closeParen + 1);
    if (text.startsWith("throws", declarationEnd) && !/[A-Za-z0-9_$]/.test(text[declarationEnd + "throws".length] || "")) {
      declarationEnd += "throws".length;
      while (
        declarationEnd < text.length
        && text[declarationEnd] !== "{"
        && text[declarationEnd] !== ";"
        && text[declarationEnd] !== "\n"
        && text[declarationEnd] !== "\r"
      ) {
        declarationEnd += 1;
      }
      declarationEnd = skipWhitespaceAndComments(text, declarationEnd);
    }
    return {
      declarationEnd,
      declarationStart: name.start,
      parameterEnd: closeParen,
      parameterStart: index + 1,
      parameterText: text.slice(index + 1, closeParen),
    };
  }
  return undefined;
}

function findJavaStepFunctions(text, externalConstants) {
  const entries = [];
  const ignoredRanges = collectIgnoredKotlinRanges(text);
  const stepImports = collectJavaStepImports(text, ignoredRanges);
  const { constants } = collectJavaStringConstants(text, externalConstants);
  const annotationPattern = /@/g;
  let match = annotationPattern.exec(text);
  while (match) {
    if (isInIgnoredRange(match.index, ignoredRanges)) {
      match = annotationPattern.exec(text);
      continue;
    }
    const annotationName = readJavaIdentifierPath(text, match.index + 1);
    if (!annotationName || !isJavaStepAnnotationAllowed(annotationName.path, stepImports)) {
      match = annotationPattern.exec(text);
      continue;
    }
    const openParen = skipWhitespaceAndComments(text, annotationName.end);
    if (text[openParen] !== "(") {
      match = annotationPattern.exec(text);
      continue;
    }
    const closeParen = findMatchingParen(text, openParen);
    if (closeParen === -1) {
      return entries;
    }
    const aliases = extractJavaStepAliases(text.slice(openParen + 1, closeParen), constants);
    const method = findNextJavaMethod(text, closeParen + 1, ignoredRanges);
    if (aliases.length > 0 && method) {
      entries.push({
        aliases,
        annotationEnd: closeParen + 1,
        annotationStart: match.index,
        ...method,
      });
    }
    annotationPattern.lastIndex = closeParen + 1;
    match = annotationPattern.exec(text);
  }
  return entries;
}

function mismatchMessage(actual, expected, alias) {
  return `${PARAMETER_MISMATCH_PREFIX}(found [${actual}] expected [${expected}]) with step annotation : "${alias}". `;
}

function documentPath(document) {
  return document && document.uri && document.uri.fsPath;
}

function uriPath(uri) {
  return uri && uri.fsPath;
}

const WORKSPACE_STEP_IMPLEMENTATION_SCAN_COMPLETE = "__gaugeStepImplementationScanComplete";
const JAVA_FILE_PATTERN = /\.java$/i;
const KOTLIN_FILE_PATTERN = /\.kts?$/i;
const CONCEPT_FILE_PATTERN = /\.cpt$/i;
const SPEC_FILE_PATTERN = /\.(?:spec|md)$/i;
const JAVA_WORKSPACE_PATTERN = "**/*.java";
const KOTLIN_WORKSPACE_PATTERN = "**/*.kt";
const CONCEPT_WORKSPACE_PATTERN = "**/*.cpt";

function markWorkspaceStepImplementationScanComplete(documents) {
  Object.defineProperty(documents, WORKSPACE_STEP_IMPLEMENTATION_SCAN_COMPLETE, {
    configurable: true,
    enumerable: false,
    value: true,
  });
  return documents;
}

function isWorkspaceStepImplementationScanComplete(workspaceDocuments) {
  return Boolean(
    workspaceDocuments
    && workspaceDocuments[WORKSPACE_STEP_IMPLEMENTATION_SCAN_COMPLETE],
  );
}

// Identify Kotlin sources by file extension rather than relying on the editor
// languageId. VS Code ships no built-in Kotlin language, so without a separate
// Kotlin extension installed `.kt` files open as "plaintext"; keying off
// languageId would then hide every step implementation from navigation and
// diagnostics. The provider already discovers these files via a `**/*.kt`
// search, so the extension is an authoritative signal.
function isKotlinDocument(candidate) {
  if (!candidate) {
    return false;
  }
  if (candidate.languageId === KOTLIN_LANGUAGE) {
    return true;
  }
  const file = documentPath(candidate);
  return typeof file === "string" && KOTLIN_FILE_PATTERN.test(file);
}

function isJavaDocument(candidate) {
  if (!candidate) {
    return false;
  }
  if (candidate.languageId === JAVA_LANGUAGE) {
    return true;
  }
  const file = documentPath(candidate);
  return typeof file === "string" && JAVA_FILE_PATTERN.test(file);
}

function isStepImplementationDocument(candidate) {
  return isKotlinDocument(candidate) || isJavaDocument(candidate);
}

function findStepFunctionsForDocument(document, externalConstants) {
  if (!document || typeof document.getText !== "function") {
    return [];
  }
  const text = document.getText();
  return isJavaDocument(document)
    ? findJavaStepFunctions(text, externalConstants)
    : findStepFunctions(text, externalConstants);
}

function isConceptDocument(candidate) {
  if (!candidate) {
    return false;
  }
  const file = documentPath(candidate);
  return typeof file === "string" && CONCEPT_FILE_PATTERN.test(file);
}

function isGaugeSpecDocument(candidate) {
  if (!candidate) {
    return false;
  }
  if (candidate.languageId === GAUGE_LANGUAGE) {
    return true;
  }
  const file = documentPath(candidate);
  return typeof file === "string" && SPEC_FILE_PATTERN.test(file);
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
      && (isStepImplementationDocument(document) || isGaugeSpecDocument(document))
      && typeof document.getText === "function"
      && this.isGaugeProjectDocument(document),
    );
  }

  collectWorkspaceConstants(document, workspaceDocuments) {
    const workspace = this.vscode.workspace || {};
    const constants = new Map();
    const constantTypes = new Map();
    const samePackageConstants = new Map();
    const samePackageConstantTypes = new Map();
    const samePackageClassifiers = new Set();
    const ambiguousWorkspaceConstants = new Set();
    const stepAliases = new Map();
    const stepAliasDocuments = [];
    const stepAliasDeclarationNames = new Set();
    const ambiguousWorkspaceStepAliases = new Set();
    const packageClassifiers = new Map();
    const textDocuments = Array.isArray(workspaceDocuments)
      ? workspaceDocuments
      : (Array.isArray(workspace.textDocuments) ? workspace.textDocuments : []);
    const activeDocumentPath = documentPath(document);
    const activeText = document.getText();
    const activeIgnoredRanges = collectIgnoredKotlinRanges(activeText);
    const activePackageName = isJavaDocument(document)
      ? collectJavaPackageName(activeText, activeIgnoredRanges)
      : collectKotlinPackageName(activeText, activeIgnoredRanges);
    const addPackageClassifiers = (packageName, names) => {
      if (packageName === undefined || names.size === 0) {
        return;
      }
      if (!packageClassifiers.has(packageName)) {
        packageClassifiers.set(packageName, new Set());
      }
      const target = packageClassifiers.get(packageName);
      for (const name of names) {
        target.add(name);
      }
    };
    if (activePackageName !== undefined && isKotlinDocument(document)) {
      addPackageClassifiers(activePackageName, localClassifierNames(activeText, activeIgnoredRanges));
    }
    for (const candidate of textDocuments) {
      const candidatePath = documentPath(candidate);
      const candidateIsKotlin = isKotlinDocument(candidate);
      const candidateIsJava = isJavaDocument(candidate);
      if (
        !candidate
        || candidate === document
        || candidatePath === activeDocumentPath
        || (!candidateIsKotlin && !candidateIsJava)
        || typeof candidate.getText !== "function"
        || !this.isGaugeProjectDocument(candidate)
      ) {
        continue;
      }

      const text = candidate.getText();
      const ignoredRanges = collectIgnoredKotlinRanges(text);
      const packageName = candidateIsJava
        ? collectJavaPackageName(text, ignoredRanges)
        : collectKotlinPackageName(text, ignoredRanges);
      if (packageName === undefined) {
        continue;
      }

      if (candidateIsKotlin) {
        const candidateClassifiers = localClassifierNames(text, ignoredRanges);
        addPackageClassifiers(packageName, candidateClassifiers);
        if (activePackageName === packageName) {
          for (const name of candidateClassifiers) {
            samePackageClassifiers.add(name);
          }
        }

        stepAliasDocuments.push({ ignoredRanges, packageName, text });
        for (const name of collectPackageQualifiedTypeAliasDeclarationNames(text, packageName, ignoredRanges)) {
          if (ambiguousWorkspaceStepAliases.has(name)) {
            continue;
          }
          if (stepAliasDeclarationNames.has(name)) {
            ambiguousWorkspaceStepAliases.add(name);
            stepAliases.delete(name);
            continue;
          }
          stepAliasDeclarationNames.add(name);
        }
      }

      const collected = candidateIsJava
        ? collectJavaStringConstants(text)
        : collectStringConstants(text);
      const packagePrefix = `${packageName}.`;
      for (const [name, value] of collected.constants) {
        if (!name.startsWith(packagePrefix) || ambiguousWorkspaceConstants.has(name)) {
          continue;
        }
        const exposedName = name.slice(packagePrefix.length);
        if (constants.has(name)) {
          constants.delete(name);
          constantTypes.delete(name);
          ambiguousWorkspaceConstants.add(name);
          if (activePackageName === packageName) {
            samePackageConstants.delete(exposedName);
            samePackageConstantTypes.delete(exposedName);
          }
          continue;
        }
        constants.set(name, value);
        if (collected.constantTypes.has(name)) {
          constantTypes.set(name, collected.constantTypes.get(name));
        }
        if (activePackageName === packageName) {
          if (!samePackageConstants.has(exposedName)) {
            samePackageConstants.set(exposedName, value);
            if (collected.constantTypes.has(name)) {
              samePackageConstantTypes.set(exposedName, collected.constantTypes.get(name));
            }
          }
        }
      }

    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const source of stepAliasDocuments) {
        const collected = collectPackageQualifiedStepTypeAliases(
          source.text,
          source.packageName,
          source.ignoredRanges,
          stepAliases,
          packageClassifiers.get(source.packageName),
        );
        for (const [name, targetName] of collected) {
          if (ambiguousWorkspaceStepAliases.has(name)) {
            if (stepAliases.delete(name)) {
              changed = true;
            }
            continue;
          }
          if (stepAliases.has(name)) {
            continue;
          }
          stepAliases.set(name, targetName);
          changed = true;
        }
      }
    }
    if (activePackageName !== undefined) {
      const packagePrefix = `${activePackageName}.`;
      for (const [name, targetName] of [...stepAliases]) {
        if (!name.startsWith(packagePrefix)) {
          continue;
        }
        if (ambiguousWorkspaceStepAliases.has(name)) {
          continue;
        }
        const exposedName = name.slice(packagePrefix.length);
        if (exposedName.includes(".") || stepAliases.has(exposedName)) {
          continue;
        }
        stepAliases.set(exposedName, targetName);
      }
    }
    return {
      constants,
      constantTypes,
      samePackageConstants,
      samePackageClassifiers,
      samePackageConstantTypes,
      stepAliases,
    };
  }

  provideDiagnostics(document, workspaceDocuments) {
    if (!this.shouldDiagnose(document)) {
      return [];
    }

    const text = document.getText();
    const diagnostics = [];
    if (isGaugeSpecDocument(document)) {
      const implementedSteps = this.implementedStepTemplates(document, workspaceDocuments);
      for (const entry of findGaugeSteps(text)) {
        const range = createRange(this.vscode, entry.start, entry.end);
        if (!entry.text && entry.marker === 0) {
          diagnostics.push(createDiagnostic(
            this.vscode,
            range,
            BLANK_STEP_MESSAGE,
          ));
        } else if (
          entry.marker === 0
          && implementedSteps
          && !implementedSteps.has(entry.normalized)
        ) {
          diagnostics.push(createDiagnostic(
            this.vscode,
            range,
            UNDEFINED_STEP_MESSAGE,
            { code: "gauge.undefinedStep", source: "gauge" },
          ));
        }
      }
      return diagnostics;
    }

    const externalConstants = isStepImplementationDocument(document)
      ? this.collectWorkspaceConstants(document, workspaceDocuments)
      : undefined;
    for (const entry of findStepFunctionsForDocument(document, externalConstants)) {
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

  kotlinDocuments(document, workspaceDocuments) {
    const workspace = this.vscode.workspace || {};
    const candidates = Array.isArray(workspaceDocuments)
      ? workspaceDocuments
      : (Array.isArray(workspace.textDocuments) ? workspace.textDocuments : []);
    return candidates.filter((candidate) => (
      candidate
      && candidate !== document
      && isKotlinDocument(candidate)
      && typeof candidate.getText === "function"
      && this.isGaugeProjectDocument(candidate)
    ));
  }

  stepImplementationDocuments(document, workspaceDocuments) {
    const workspace = this.vscode.workspace || {};
    const candidates = Array.isArray(workspaceDocuments)
      ? workspaceDocuments
      : (Array.isArray(workspace.textDocuments) ? workspace.textDocuments : []);
    return candidates.filter((candidate) => (
      candidate
      && candidate !== document
      && isStepImplementationDocument(candidate)
      && typeof candidate.getText === "function"
      && this.isGaugeProjectDocument(candidate)
    ));
  }

  conceptDocuments(workspaceDocuments) {
    const workspace = this.vscode.workspace || {};
    const candidates = Array.isArray(workspaceDocuments)
      ? workspaceDocuments
      : (Array.isArray(workspace.textDocuments) ? workspace.textDocuments : []);
    return candidates.filter((candidate) => (
      candidate
      && isConceptDocument(candidate)
      && typeof candidate.getText === "function"
      && this.isGaugeProjectDocument(candidate)
    ));
  }

  implementedStepTemplates(document, workspaceDocuments) {
    const implementationDocuments = this.stepImplementationDocuments(document, workspaceDocuments);
    const conceptDocuments = this.conceptDocuments(workspaceDocuments);
    if (implementationDocuments.length === 0 && conceptDocuments.length === 0) {
      if (isWorkspaceStepImplementationScanComplete(workspaceDocuments)) {
        return new Set();
      }
      return undefined;
    }

    const templates = new Set();
    for (const candidate of implementationDocuments) {
      let externalConstants;
      if (isStepImplementationDocument(candidate)) {
        try {
          externalConstants = this.collectWorkspaceConstants(candidate, implementationDocuments);
        } catch (_error) {
          externalConstants = undefined;
        }
      }
      for (const entry of findStepFunctionsForDocument(candidate, externalConstants)) {
        for (const alias of entry.aliases) {
          templates.add(normalizeStepTemplate(alias));
        }
      }
    }
    for (const candidate of conceptDocuments) {
      for (const heading of findConceptHeadings(candidate.getText())) {
        templates.add(heading.normalized);
      }
    }
    return templates;
  }

  updateDocument(collection, document, workspaceDocuments) {
    if (!document || !document.uri) {
      return;
    }
    if (!this.shouldDiagnose(document)) {
      if (typeof collection.delete === "function") {
        collection.delete(document.uri);
      }
      return;
    }
    collection.set(document.uri, this.provideDiagnostics(document, workspaceDocuments));
  }

  addWorkspaceDocument(documents, seenPaths, candidate) {
    if (!candidate || typeof candidate.getText !== "function") {
      return;
    }
    const file = documentPath(candidate);
    if (file) {
      if (seenPaths.has(file)) {
        return;
      }
      seenPaths.add(file);
    } else if (documents.includes(candidate)) {
      return;
    }
    documents.push(candidate);
  }

  workspaceDocuments() {
    const workspace = this.vscode.workspace || {};
    const documents = [];
    const seenPaths = new Set();
    const openDocuments = Array.isArray(workspace.textDocuments) ? workspace.textDocuments : [];
    for (const candidate of openDocuments) {
      this.addWorkspaceDocument(documents, seenPaths, candidate);
    }

    if (
      typeof workspace.findFiles !== "function"
      || typeof workspace.openTextDocument !== "function"
    ) {
      return documents;
    }

    return (async () => {
      const documentPatterns = [
        {
          matches: isKotlinDocument,
          pattern: KOTLIN_WORKSPACE_PATTERN,
        },
        {
          matches: isJavaDocument,
          pattern: JAVA_WORKSPACE_PATTERN,
        },
        {
          matches: isConceptDocument,
          pattern: CONCEPT_WORKSPACE_PATTERN,
        },
      ];
      for (const { matches, pattern } of documentPatterns) {
        let uris;
        try {
          uris = await workspace.findFiles(pattern);
        } catch (_error) {
          continue;
        }
        for (const uri of uris || []) {
          const file = uriPath(uri);
          if (file && seenPaths.has(file)) {
            continue;
          }
          if (file && this.projectFactory && typeof this.projectFactory.getGaugeRootFromFilePath === "function") {
            try {
              this.projectFactory.getGaugeRootFromFilePath(file);
            } catch (_error) {
              continue;
            }
          }

          try {
            const document = await workspace.openTextDocument(uri);
            if (matches(document)) {
              this.addWorkspaceDocument(documents, seenPaths, document);
            }
          } catch (_error) {
            // Keep diagnostics available when one workspace URI is stale or unreadable.
          }
        }
      }
      return markWorkspaceStepImplementationScanComplete(documents);
    })();
  }

  refreshDocumentsWith(collection, workspaceDocuments) {
    const workspace = this.vscode.workspace || {};
    for (const document of workspace.textDocuments || []) {
      this.updateDocument(collection, document, workspaceDocuments);
    }
  }

  refreshDocuments(collection) {
    const workspaceDocuments = this.workspaceDocuments();
    if (workspaceDocuments && typeof workspaceDocuments.then === "function") {
      return workspaceDocuments.then((documents) => this.refreshDocumentsWith(collection, documents));
    }
    this.refreshDocumentsWith(collection, workspaceDocuments);
    return undefined;
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

    this.refreshDocuments(collection);
    registerListener("onDidOpenTextDocument", () => this.refreshDocuments(collection));
    registerListener("onDidChangeTextDocument", () => this.refreshDocuments(collection));
    registerListener("onDidCloseTextDocument", (document) => {
      if (document && document.uri && typeof collection.delete === "function") {
        collection.delete(document.uri);
      }
      this.refreshDocuments(collection);
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
  UNDEFINED_STEP_MESSAGE,
  countKotlinParameters,
  countStepParameters,
  findConceptHeadings,
  findJavaStepFunctions,
  findStepFunctions,
  findStepFunctionsForDocument,
  isConceptDocument,
  isJavaDocument,
  isKotlinDocument,
  isStepImplementationDocument,
  positionAt,
};
