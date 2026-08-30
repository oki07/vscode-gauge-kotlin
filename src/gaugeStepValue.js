"use strict";

// Two grammars meet when the extension asks "is this step implemented?", and
// they are NOT the same grammar. Both live here so that every module answers
// with the same one; test/stepKeyAgreement.test.js checks that they do.
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
