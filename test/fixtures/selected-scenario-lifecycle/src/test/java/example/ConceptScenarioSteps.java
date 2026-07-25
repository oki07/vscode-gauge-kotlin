package example;

import com.thoughtworks.gauge.Step;

public class ConceptScenarioSteps {

    @Step("Record concept leaf one.")
    public void recordConceptLeafOne() {
        log("Leaf:one");
    }

    @Step("Record concept leaf two.")
    public void recordConceptLeafTwo() {
        log("Leaf:two");
    }

    private static void log(String event) {
        if (LifecycleLog.isCase("concept-leaves")) {
            LifecycleLog.append(event);
        }
    }
}
