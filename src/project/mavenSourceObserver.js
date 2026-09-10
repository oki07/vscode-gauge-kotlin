"use strict";

module.exports = String.raw`import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.apache.maven.execution.MojoExecutionEvent;
import org.apache.maven.execution.MojoExecutionListener;
import org.apache.maven.plugin.MojoExecution;
import org.apache.maven.plugin.MojoExecutionException;

/** Kotlin Maven plugin 2.2.21 exposes configured roots on its executing Mojo. */
public class SourceModelObserver extends org.apache.maven.AbstractMavenLifecycleParticipant implements MojoExecutionListener {
    private static final List<String> records = new ArrayList<>();
    private static String failure;

    @Override
    public void afterSessionEnd(org.apache.maven.execution.MavenSession session) {
        try {
            String output = session.getUserProperties().getProperty("gauge.source.model.output");
            String root = new File(session.getRequest().getBaseDirectory()).getCanonicalPath();
            String json = "{\"version\":1,\"projectRoot\":" + quote(root)
                + ",\"languages\":[\"kotlin\"],\"compilations\":[" + String.join(",", records) + "]"
                + (failure == null ? "" : ",\"error\":" + quote(failure)) + "}";
            Files.write(Paths.get(output), json.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            // Missing observation output makes the query unavailable without failing Maven.
        }
    }
    @Override
    public void afterMojoExecutionSuccess(MojoExecutionEvent event) {}

    @Override
    public void afterExecutionFailure(MojoExecutionEvent event) {}

    private static Method method(Object object, String name) throws Exception {
        for (Class<?> type = object.getClass(); type != null; type = type.getSuperclass()) {
            try {
                Method result = type.getDeclaredMethod(name);
                result.setAccessible(true);
                return result;
            } catch (NoSuchMethodException ignored) {
                // The Kotlin test compiler inherits part of the implementation.
            }
        }
        throw new NoSuchMethodException(name);
    }

    private static Object field(Object object, String name) throws Exception {
        for (Class<?> type = object.getClass(); type != null; type = type.getSuperclass()) {
            try {
                Field result = type.getDeclaredField(name);
                result.setAccessible(true);
                return result.get(object);
            } catch (NoSuchFieldException ignored) {
                // Configuration fields also live in compiler base classes.
            }
        }
        throw new NoSuchFieldException(name);
    }

    private static String quote(String text) {
        StringBuilder result = new StringBuilder("\"");
        for (char value : text.toCharArray()) {
            if (value == '\\' || value == '"') {
                result.append('\\').append(value);
            } else if (value < 32) {
                result.append(String.format("\\u%04x", (int) value));
            } else {
                result.append(value);
            }
        }
        return result.append('"').toString();
    }

    private static String array(List<String> values) {
        List<String> encoded = new ArrayList<>();
        for (String value : values) encoded.add(quote(value));
        return "[" + String.join(",", encoded) + "]";
    }

    private static List<String> extraSources(Object mojo) throws Exception {
        Object configured = field(mojo, "args");
        if (configured == null) return Collections.emptyList();
        List<?> arguments = (List<?>) configured;
        Object compiler = method(mojo, "createCompiler").invoke(mojo);
        Object parsed = method(mojo, "createCompilerArguments").invoke(mojo);
        Method parse = null;
        for (Method candidate : compiler.getClass().getMethods()) {
            Class<?>[] parameters = candidate.getParameterTypes();
            if (candidate.getName().equals("parseArguments") && parameters.length == 2
                    && parameters[0] == String[].class && parameters[1].isInstance(parsed)) {
                parse = candidate;
                break;
            }
        }
        if (parse == null) throw new NoSuchMethodException("parseArguments");
        parse.invoke(compiler, arguments.toArray(new String[0]), parsed);
        List<?> free = (List<?>) parsed.getClass().getMethod("getFreeArgs").invoke(parsed);
        List<String> result = new ArrayList<>();
        for (Object path : free) {
            File file = new File((String) path);
            if (!file.isAbsolute() && Boolean.TRUE.equals(field(mojo, "useDaemon"))) {
                throw new IllegalArgumentException("Relative Kotlin daemon inputs have an unverified base");
            }
            result.add(file.getCanonicalPath());
        }
        return result;
    }

    @Override
    public void beforeMojoExecution(MojoExecutionEvent event) throws MojoExecutionException {
        MojoExecution execution = event.getExecution();
        if (!execution.getGroupId().equals("org.jetbrains.kotlin")
                || !execution.getArtifactId().equals("kotlin-maven-plugin")
                || (!execution.getGoal().equals("test-compile")
                    && !execution.getGoal().equals("compile"))) return;
        try {
            if (!"2.2.21".equals(execution.getVersion())) {
                throw new IllegalArgumentException("Unsupported Kotlin Maven compiler version: " + execution.getVersion());
            }
            Object mojo = event.getMojo();
            boolean skipped = execution.getGoal().equals("test-compile")
                && Boolean.TRUE.equals(field(mojo, "skip"));
            boolean hasSources = !skipped
                && Boolean.TRUE.equals(method(mojo, "hasKotlinFilesInSources").invoke(mojo));
            List<?> roots = (List<?>) method(mojo, "getSourceDirs").invoke(mojo);
            List<String> paths = new ArrayList<>();
            for (Object root : roots) paths.add(((File) root).getCanonicalPath());
            List<String> extra = hasSources ? extraSources(mojo) : Collections.emptyList();
            String record = "{\"projectRoot\":" + quote(event.getProject().getBasedir().getCanonicalPath())
                + ",\"goal\":" + quote(execution.getGoal())
                + ",\"executionId\":" + quote(execution.getExecutionId())
                + ",\"compilerVersion\":" + quote(execution.getVersion())
                + ",\"skipped\":" + skipped + ",\"hasSources\":" + hasSources
                + ",\"language\":\"kotlin\",\"sourcePaths\":" + array(paths)
                + ",\"additionalSourcePaths\":" + array(extra)
                + ",\"configuredOutputDirectory\":" + quote(new File((String) field(mojo,
                    execution.getGoal().equals("test-compile") ? "testOutput" : "output")).getCanonicalPath()) + "}";
            synchronized (SourceModelObserver.class) {
                records.add(record);
            }
        } catch (Exception | LinkageError error) {
            synchronized (SourceModelObserver.class) {
                failure = "Cannot inspect the configured Kotlin compiler: " + error;
            }
        }
    }
}
`;
