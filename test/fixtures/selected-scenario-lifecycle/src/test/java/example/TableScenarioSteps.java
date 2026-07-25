package example;

import com.thoughtworks.gauge.Step;

public class TableScenarioSteps {

    @Step("Record spec table row <value>.")
    public void recordSpecTableRow(String value) {
        if (LifecycleLog.isCase("spec-table")) {
            LifecycleLog.append("Step:" + value);
        }
    }

    @Step("Record scenario table row <value>.")
    public void recordScenarioTableRow(String value) {
        if (LifecycleLog.isCase("scenario-table")) {
            LifecycleLog.append("Step:" + value);
        }
    }
}
