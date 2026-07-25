package example;

import com.thoughtworks.gauge.Step;

public class ContextScenarioSteps {

    @Step("Prepare the selected fixture.")
    public void prepareSelectedFixture() {
        if (!isContextCase()) {
            return;
        }
        if (LifecycleLog.isCase("context-failure")) {
            LifecycleLog.append("Context:fail");
            throw new IllegalStateException("Context fixture failure");
        }
        LifecycleLog.append("Context");
    }

    @Step("Run the selected fixture body.")
    public void runSelectedFixtureBody() {
        if (!isContextCase()) {
            return;
        }
        if (LifecycleLog.isCase("body-failure")) {
            LifecycleLog.append("Body:fail");
            throw new IllegalStateException("Body fixture failure");
        }
        LifecycleLog.append("Body");
    }

    @Step("Clean the selected fixture.")
    public void cleanSelectedFixture() {
        if (isContextCase()) {
            LifecycleLog.append("Teardown");
        }
    }

    private static boolean isContextCase() {
        return LifecycleLog.isCase("context-success")
            || LifecycleLog.isCase("context-failure")
            || LifecycleLog.isCase("body-failure");
    }
}
