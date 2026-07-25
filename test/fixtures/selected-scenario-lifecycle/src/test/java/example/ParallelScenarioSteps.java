package example;

import com.thoughtworks.gauge.Step;
import java.lang.management.ManagementFactory;

public class ParallelScenarioSteps {

    @Step("Record parallel lifecycle <value>.")
    public void recordParallelLifecycle(String value) {
        if (!isParallelCase()) {
            return;
        }
        LifecycleLog.append("Step:" + value + "@" + processId());
    }

    private static boolean isParallelCase() {
        return LifecycleLog.isCase("parallel-process")
            || LifecycleLog.isCase("parallel-thread");
    }

    private static String processId() {
        String runtimeName = ManagementFactory.getRuntimeMXBean().getName();
        int delimiter = runtimeName.indexOf('@');
        return delimiter < 0 ? runtimeName : runtimeName.substring(0, delimiter);
    }
}
