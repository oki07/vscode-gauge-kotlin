# Gauge Kotlin

Gauge Kotlin provides Visual Studio Code support for Gauge specifications backed
by Kotlin step implementations.

## Features

- Gauge specification and concept language registration.
- Gauge commands for project creation, specification and concept creation,
  preview, formatting, extraction, execution, debugging, reports, and step
  references.
- Gauge LSP workspace startup for Gauge projects and Kotlin implementation
  files.
- Local Kotlin `@Step` diagnostics, definition lookup, completions, and
  implementation-to-Gauge reference fallback for deterministic Kotlin workflows.

## Requirements

- Visual Studio Code 1.82 or newer.
- Gauge CLI 0.9.6 or newer.
- A Gauge project using Kotlin step implementations.

Kotlin source intelligence outside Gauge step integration is expected to come
from a Kotlin language extension such as Kotlin by JetBrains.
