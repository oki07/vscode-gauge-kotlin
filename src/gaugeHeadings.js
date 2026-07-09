"use strict";

function trimmedHashText(line) {
  return String(line || "").trimStart();
}

function isSpecHashHeading(line) {
  const text = trimmedHashText(line);
  return text.startsWith("#") && !text.startsWith("##");
}

function isScenarioHashHeading(line) {
  const text = trimmedHashText(line);
  return text === "##" || (text.startsWith("##") && text[2] !== "#");
}

function isGaugeHashHeading(line) {
  return isSpecHashHeading(line) || isScenarioHashHeading(line);
}

function isConceptHashHeading(line) {
  return trimmedHashText(line).startsWith("#");
}

module.exports = {
  isConceptHashHeading,
  isGaugeHashHeading,
  isScenarioHashHeading,
  isSpecHashHeading,
};
