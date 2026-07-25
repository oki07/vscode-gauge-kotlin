package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterSpec;
import com.thoughtworks.gauge.AfterStep;
import com.thoughtworks.gauge.AfterSuite;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeSpec;
import com.thoughtworks.gauge.BeforeStep;
import com.thoughtworks.gauge.BeforeSuite;
import com.thoughtworks.gauge.ExecutionContext;
import com.thoughtworks.gauge.datastore.ScenarioDataStore;

public class RetryLifecycleHooks {

    private static final String KEY = "retry-fixture";

    @BeforeSuite
    public void retryBeforeSuite() {
        log("BeforeSuite");
    }

    @BeforeSpec
    public void retryBeforeSpec() {
        log("BeforeSpec");
    }

    @BeforeScenario
    public void retryBeforeScenario() {
        if (!isRetryCase()) {
            return;
        }
        LifecycleLog.append(
            "BeforeScenario:scenario=" + ScenarioDataStore.get(KEY)
        );
        ScenarioDataStore.put(KEY, "set");
    }

    @BeforeStep
    public void retryBeforeStep(ExecutionContext context) {
        if (isRetryCase()) {
            LifecycleLog.append("BeforeStep:" + context.getCurrentStep().getText());
        }
    }

    @AfterStep
    public void retryAfterStep(ExecutionContext context) {
        if (isRetryCase()) {
            LifecycleLog.append("AfterStep:" + context.getCurrentStep().getText());
        }
    }

    @AfterScenario
    public void retryAfterScenario() {
        if (isRetryCase()) {
            LifecycleLog.append(
                "AfterScenario:scenario=" + ScenarioDataStore.get(KEY)
            );
        }
    }

    @AfterSpec
    public void retryAfterSpec() {
        log("AfterSpec");
    }

    @AfterSuite
    public void retryAfterSuite() {
        log("AfterSuite");
    }

    private static boolean isRetryCase() {
        return LifecycleLog.isCase("retry-match")
            || LifecycleLog.isCase("retry-nonmatch");
    }

    private static void log(String event) {
        if (isRetryCase()) {
            LifecycleLog.append(event);
        }
    }
}
