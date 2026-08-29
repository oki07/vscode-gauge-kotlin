"use strict";

// Two grammars meet when the extension asks "is this step implemented?", and
// they are NOT the same grammar. Keeping them in one place is the point of this
// module: the rule used to live in eight copies of one file's helper, and
// correcting some of them made the editor contradict itself - the diagnostics
// called a step undefined while Go to Definition resolved it, and a rename
// rewrote a specification while silently leaving its annotation behind.
//
// SPEC side: references/gauge parser.ExtractStepValueAndParams. A quoted run and
// a <dynamic> run are both arguments and collapse to {}; a bare "{" or "}" is a
// reserved character and must be written "\{". That rule is normalizeStepTemplate
// in src/stepDefinitionProvider.js and src/stepDiagnostics.js.
//
// RUNNER side: references/gauge-java scan/RegistryMethodVisitor keys StepRegistry
// on scan/StepsUtil.getStepText, whose entire body is
//   parameterizedStepText.replaceAll("(<.*?>)", "{}")
// so a quoted run stays literal and braces are ordinary characters. Verified by
// running that method in a JDK against the JavaScript below: byte-identical over
// twelve shapes including nested and multiline angle brackets.
const ANNOTATION_PARAMETER_PATTERN = /<.*?>/g;

function annotationStepTemplate(alias) {
  return String(alias || "").replace(ANNOTATION_PARAMETER_PATTERN, "{}");
}

module.exports = {
  annotationStepTemplate,
};
