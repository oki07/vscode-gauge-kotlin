package example;

import com.thoughtworks.gauge.SkipScenarioException;
import com.thoughtworks.gauge.Step;

public class SkipScenarioSteps {

    @Step("Prepare the skip fixture.")
    public void prepareSkipFixture() {
        if (LifecycleLog.isCase("skip-step")) {
            LifecycleLog.append("Context");
        }
    }

    @Step("Skip the selected scenario.")
    public void skipSelectedScenario() {
        if (LifecycleLog.isCase("skip-step")) {
            LifecycleLog.append("Step:skip");
            throw new SkipScenarioException("Skip from step");
        }
    }

    @Step("Clean the skip fixture.")
    public void cleanSkipFixture() {
        if (LifecycleLog.isCase("skip-step")) {
            LifecycleLog.append("Teardown");
        }
    }
}
