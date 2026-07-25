package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterStep;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeStep;
import com.thoughtworks.gauge.ExecutionContext;

public class SkipLifecycleHooks {

    @BeforeScenario
    public void skipBeforeScenario() {
        if (!LifecycleLog.isCase("skip-step")) {
            return;
        }
        LifecycleLog.append("BeforeScenario");
    }

    @BeforeStep
    public void skipBeforeStep(ExecutionContext context) {
        if (isSkipCase()) {
            LifecycleLog.append("BeforeStep:" + context.getCurrentStep().getText());
        }
    }

    @AfterStep
    public void skipAfterStep(ExecutionContext context) {
        if (isSkipCase()) {
            LifecycleLog.append("AfterStep:" + context.getCurrentStep().getText());
        }
    }

    @AfterScenario
    public void skipAfterScenario() {
        if (isSkipCase()) {
            LifecycleLog.append("AfterScenario");
        }
    }

    private static boolean isSkipCase() {
        return LifecycleLog.isCase("skip-step");
    }
}
