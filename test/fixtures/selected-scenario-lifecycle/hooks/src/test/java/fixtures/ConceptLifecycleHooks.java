package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterStep;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeStep;
import com.thoughtworks.gauge.ExecutionContext;

public class ConceptLifecycleHooks {

    @BeforeScenario
    public void conceptBeforeScenario() {
        log("BeforeScenario");
    }

    @BeforeStep
    public void conceptBeforeStep(ExecutionContext context) {
        log("BeforeStep:" + context.getCurrentStep().getText());
    }

    @AfterStep
    public void conceptAfterStep(ExecutionContext context) {
        log("AfterStep:" + context.getCurrentStep().getText());
    }

    @AfterScenario
    public void conceptAfterScenario() {
        log("AfterScenario");
    }

    private static void log(String event) {
        if (LifecycleLog.isCase("concept-leaves")) {
            LifecycleLog.append(event);
        }
    }
}
