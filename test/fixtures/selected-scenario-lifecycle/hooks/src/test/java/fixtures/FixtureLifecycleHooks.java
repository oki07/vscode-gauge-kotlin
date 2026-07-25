package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterSpec;
import com.thoughtworks.gauge.AfterStep;
import com.thoughtworks.gauge.AfterSuite;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeSpec;
import com.thoughtworks.gauge.BeforeStep;
import com.thoughtworks.gauge.BeforeSuite;

public class FixtureLifecycleHooks {

    @BeforeSuite
    public void beforeSuite() {
        if (!LifecycleLog.isCase("baseline")) {
            return;
        }
        LifecycleLog.reset("BeforeSuite");
    }

    @BeforeSpec
    public void beforeSpec() {
        if (!LifecycleLog.isCase("baseline")) {
            return;
        }
        LifecycleLog.append("BeforeSpec");
    }

    @BeforeScenario
    public void beforeScenario() {
        if (!LifecycleLog.isCase("baseline")) {
            return;
        }
        LifecycleLog.append("BeforeScenario");
    }

    @BeforeStep
    public void beforeStep() {
        if (!LifecycleLog.isCase("baseline")) {
            return;
        }
        LifecycleLog.append("BeforeStep");
    }

    @AfterStep
    public void afterStep() {
        if (!LifecycleLog.isCase("baseline")) {
            return;
        }
        LifecycleLog.append("AfterStep");
    }

    @AfterScenario
    public void afterScenario() {
        if (!LifecycleLog.isCase("baseline")) {
            return;
        }
        LifecycleLog.append("AfterScenario");
    }

    @AfterSpec
    public void afterSpec() {
        if (!LifecycleLog.isCase("baseline")) {
            return;
        }
        LifecycleLog.append("AfterSpec");
    }

    @AfterSuite
    public void afterSuite() {
        if (!LifecycleLog.isCase("baseline")) {
            return;
        }
        LifecycleLog.append("AfterSuite");
    }
}
