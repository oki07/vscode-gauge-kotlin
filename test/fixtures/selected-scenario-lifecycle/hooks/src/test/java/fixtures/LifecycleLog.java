package fixtures;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.Collections;

final class LifecycleLog {

    private static final String LOG_ENVIRONMENT_VARIABLE = "GAUGE_LIFECYCLE_LOG";

    private LifecycleLog() {
    }

    static void reset(String event) {
        try {
            Files.write(
                logPath(),
                Collections.singletonList(event),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING
            );
        } catch (IOException error) {
            throw new IllegalStateException("Cannot reset the lifecycle log.", error);
        }
    }

    static void append(String event) {
        try {
            Files.write(
                logPath(),
                Collections.singletonList(event),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
            );
        } catch (IOException error) {
            throw new IllegalStateException("Cannot append to the lifecycle log.", error);
        }
    }

    private static Path logPath() {
        String filename = System.getenv(LOG_ENVIRONMENT_VARIABLE);
        if (filename == null || filename.trim().isEmpty()) {
            throw new IllegalStateException(
                LOG_ENVIRONMENT_VARIABLE + " is not configured."
            );
        }
        return Paths.get(filename);
    }
}
