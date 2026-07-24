package example;

import com.thoughtworks.gauge.Step;

public class SelectedScenarioSteps {

    @Step("Record the selected scenario lifecycle.")
    public void recordLifecycle() {
        LifecycleLog.append("Step");
    }
}
