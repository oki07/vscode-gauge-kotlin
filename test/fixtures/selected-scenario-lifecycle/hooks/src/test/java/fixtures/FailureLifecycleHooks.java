package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterSpec;
import com.thoughtworks.gauge.AfterStep;
import com.thoughtworks.gauge.AfterSuite;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeSpec;
import com.thoughtworks.gauge.BeforeStep;
import com.thoughtworks.gauge.BeforeSuite;

public class FailureLifecycleHooks {

    @BeforeSuite
    public void aFailureBeforeSuite() {
        if (!isFailureCase()) {
            return;
        }
        LifecycleLog.append(
            LifecycleLog.isCase("fail-before-suite")
                ? "BeforeSuite:first"
                : "BeforeSuite"
        );
    }

    @BeforeSuite
    public void bFailBeforeSuite() {
        fail("fail-before-suite", "BeforeSuite");
    }

    @BeforeSuite
    public void cShouldNotRunAfterBeforeSuiteFailure() {
        shouldNotRun("fail-before-suite", "BeforeSuite");
    }

    @BeforeSpec
    public void aFailureBeforeSpec() {
        if (!isFailureCase()) {
            return;
        }
        LifecycleLog.append(
            LifecycleLog.isCase("fail-before-spec")
                ? "BeforeSpec:first"
                : "BeforeSpec"
        );
    }

    @BeforeSpec
    public void bFailBeforeSpec() {
        fail("fail-before-spec", "BeforeSpec");
    }

    @BeforeSpec
    public void cShouldNotRunAfterBeforeSpecFailure() {
        shouldNotRun("fail-before-spec", "BeforeSpec");
    }

    @BeforeScenario
    public void aFailureBeforeScenario() {
        if (!isFailureCase()) {
            return;
        }
        LifecycleLog.append(
            LifecycleLog.isCase("fail-before-scenario")
                ? "BeforeScenario:first"
                : "BeforeScenario"
        );
    }

    @BeforeScenario
    public void bFailBeforeScenario() {
        fail("fail-before-scenario", "BeforeScenario");
    }

    @BeforeScenario
    public void cShouldNotRunAfterBeforeScenarioFailure() {
        shouldNotRun("fail-before-scenario", "BeforeScenario");
    }

    @BeforeStep
    public void aFailureBeforeStep() {
        if (!isFailureCase()) {
            return;
        }
        LifecycleLog.append(
            LifecycleLog.isCase("fail-before-step")
                ? "BeforeStep:first"
                : "BeforeStep"
        );
    }

    @BeforeStep
    public void bFailBeforeStep() {
        fail("fail-before-step", "BeforeStep");
    }

    @BeforeStep
    public void cShouldNotRunAfterBeforeStepFailure() {
        shouldNotRun("fail-before-step", "BeforeStep");
    }

    @AfterStep
    public void failureAfterStep() {
        if (isFailureCase()) {
            LifecycleLog.append("AfterStep");
        }
    }

    @AfterScenario
    public void failureAfterScenario() {
        if (isFailureCase()) {
            LifecycleLog.append("AfterScenario");
        }
    }

    @AfterSpec
    public void failureAfterSpec() {
        if (isFailureCase()) {
            LifecycleLog.append("AfterSpec");
        }
    }

    @AfterSuite
    public void failureAfterSuite() {
        if (isFailureCase()) {
            LifecycleLog.append("AfterSuite");
        }
    }

    private static void fail(String lifecycleCase, String phase) {
        if (!LifecycleLog.isCase(lifecycleCase)) {
            return;
        }
        LifecycleLog.append(phase + ":fail");
        throw new IllegalStateException(phase + " fixture failure");
    }

    private static boolean isFailureCase() {
        return LifecycleLog.isCase("fail-before-suite")
            || LifecycleLog.isCase("fail-before-spec")
            || LifecycleLog.isCase("fail-before-scenario")
            || LifecycleLog.isCase("fail-before-step");
    }

    private static void shouldNotRun(String lifecycleCase, String phase) {
        if (LifecycleLog.isCase(lifecycleCase)) {
            LifecycleLog.append(phase + ":should-not-run");
        }
    }
}
