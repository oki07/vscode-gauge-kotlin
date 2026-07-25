package example;

import com.thoughtworks.gauge.Step;
import java.util.concurrent.atomic.AtomicInteger;

public class RetryScenarioSteps {

    private static final AtomicInteger ATTEMPTS = new AtomicInteger();

    @Step("Prepare the retry fixture.")
    public void prepareRetryFixture() {
        if (isRetryCase()) {
            LifecycleLog.append("Context");
        }
    }

    @Step("Run the retry fixture.")
    public void runRetryFixture() {
        if (!isRetryCase()) {
            return;
        }
        int attempt = ATTEMPTS.incrementAndGet();
        LifecycleLog.append("Step:attempt-" + attempt);
        if (attempt == 1) {
            throw new IllegalStateException("First retry fixture attempt fails");
        }
    }

    @Step("Clean the retry fixture.")
    public void cleanRetryFixture() {
        if (isRetryCase()) {
            LifecycleLog.append("Teardown");
        }
    }

    private static boolean isRetryCase() {
        return LifecycleLog.isCase("retry-match")
            || LifecycleLog.isCase("retry-nonmatch");
    }
}
