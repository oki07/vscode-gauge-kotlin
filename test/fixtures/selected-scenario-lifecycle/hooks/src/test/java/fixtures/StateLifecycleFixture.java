package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.Step;
import java.util.concurrent.atomic.AtomicInteger;

public class StateLifecycleFixture {

    private static final AtomicInteger NEXT_ID = new AtomicInteger();

    private final int id = NEXT_ID.incrementAndGet();

    @BeforeScenario
    public void stateBeforeScenario() {
        log("BeforeScenario");
    }

    @Step("Record the state lifecycle fixture.")
    public void recordStateLifecycleFixture() {
        log("Step");
    }

    @AfterScenario
    public void stateAfterScenario() {
        log("AfterScenario");
    }

    private static boolean isStateCase() {
        return LifecycleLog.isCase("state-scenario")
            || LifecycleLog.isCase("state-spec");
    }

    private void log(String phase) {
        if (isStateCase()) {
            LifecycleLog.append(phase + ":" + id);
        }
    }
}
