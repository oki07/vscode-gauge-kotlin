package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterStep;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeStep;
import com.thoughtworks.gauge.ExecutionContext;

public class ContextLifecycleHooks {

    @BeforeScenario
    public void contextBeforeScenario() {
        log("BeforeScenario");
    }

    @BeforeStep
    public void contextBeforeStep(ExecutionContext context) {
        log("BeforeStep:" + context.getCurrentStep().getText());
    }

    @AfterStep
    public void contextAfterStep(ExecutionContext context) {
        log("AfterStep:" + context.getCurrentStep().getText());
    }

    @AfterScenario
    public void contextAfterScenario() {
        log("AfterScenario");
    }

    private static boolean isContextCase() {
        return LifecycleLog.isCase("context-success")
            || LifecycleLog.isCase("context-failure")
            || LifecycleLog.isCase("body-failure");
    }

    private static void log(String event) {
        if (isContextCase()) {
            LifecycleLog.append(event);
        }
    }
}
