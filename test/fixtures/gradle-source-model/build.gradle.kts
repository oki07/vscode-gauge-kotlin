plugins { kotlin("jvm") version "2.2.21" }
repositories { mavenCentral() }

val generateSource by tasks.registering {
    val output = layout.buildDirectory.dir("generated/source-model")
    outputs.dir(output)
    doLast {
        output.get().asFile.mkdirs()
        output.get().file("Generated.kt").asFile.writeText("class Generated\n")
    }
}
kotlin.sourceSets.named("test") {
    kotlin.srcDir("custom-tests")
    kotlin.srcDir(layout.buildDirectory.dir("generated/source-model"))
    kotlin.exclude("Excluded.kt")
}
tasks.named("compileTestKotlin") { dependsOn(generateSource) }
