package example;

import com.thoughtworks.gauge.Step;

public class FailureScenarioSteps {

    @Step("Record the failure lifecycle body.")
    public void recordFailureLifecycleBody() {
        if (isFailureCase()) {
            LifecycleLog.append("StepBody");
        }
    }

    private static boolean isFailureCase() {
        return LifecycleLog.isCase("fail-before-suite")
            || LifecycleLog.isCase("fail-before-spec")
            || LifecycleLog.isCase("fail-before-scenario")
            || LifecycleLog.isCase("fail-before-step");
    }
}
