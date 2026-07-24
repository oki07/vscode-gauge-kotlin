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
        LifecycleLog.reset("BeforeSuite");
    }

    @BeforeSpec
    public void beforeSpec() {
        LifecycleLog.append("BeforeSpec");
    }

    @BeforeScenario
    public void beforeScenario() {
        LifecycleLog.append("BeforeScenario");
    }

    @BeforeStep
    public void beforeStep() {
        LifecycleLog.append("BeforeStep");
    }

    @AfterStep
    public void afterStep() {
        LifecycleLog.append("AfterStep");
    }

    @AfterScenario
    public void afterScenario() {
        LifecycleLog.append("AfterScenario");
    }

    @AfterSpec
    public void afterSpec() {
        LifecycleLog.append("AfterSpec");
    }

    @AfterSuite
    public void afterSuite() {
        LifecycleLog.append("AfterSuite");
    }
}
