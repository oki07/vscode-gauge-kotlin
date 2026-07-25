package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterSpec;
import com.thoughtworks.gauge.AfterSuite;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeSpec;
import com.thoughtworks.gauge.BeforeSuite;
import com.thoughtworks.gauge.ExecutionContext;
import java.lang.management.ManagementFactory;

public class ParallelLifecycleHooks {

    @BeforeSuite
    public void parallelBeforeSuite() {
        log("BeforeSuite:");
    }

    @BeforeSpec
    public void parallelBeforeSpec(ExecutionContext context) {
        log("BeforeSpec:" + context.getCurrentSpecification().getName());
    }

    @BeforeScenario
    public void parallelBeforeScenario(ExecutionContext context) {
        log("BeforeScenario:" + context.getCurrentScenario().getName());
    }

    @AfterScenario
    public void parallelAfterScenario(ExecutionContext context) {
        log("AfterScenario:" + context.getCurrentScenario().getName());
    }

    @AfterSpec
    public void parallelAfterSpec(ExecutionContext context) {
        log("AfterSpec:" + context.getCurrentSpecification().getName());
    }

    @AfterSuite
    public void parallelAfterSuite() {
        log("AfterSuite:");
    }

    private static boolean isParallelCase() {
        return LifecycleLog.isCase("parallel-process")
            || LifecycleLog.isCase("parallel-thread");
    }

    private static void log(String event) {
        if (isParallelCase()) {
            LifecycleLog.append(event + "@" + processId());
        }
    }

    private static String processId() {
        String runtimeName = ManagementFactory.getRuntimeMXBean().getName();
        int delimiter = runtimeName.indexOf('@');
        return delimiter < 0 ? runtimeName : runtimeName.substring(0, delimiter);
    }
}
