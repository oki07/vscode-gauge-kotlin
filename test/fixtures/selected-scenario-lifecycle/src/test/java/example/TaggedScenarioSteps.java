package example;

import com.thoughtworks.gauge.Step;

public class TaggedScenarioSteps {

    @Step("Record the tagged lifecycle.")
    public void recordTaggedLifecycle() {
        if (LifecycleLog.isCase("tagged-order")) {
            LifecycleLog.append("TaggedStep");
        }
    }
}
