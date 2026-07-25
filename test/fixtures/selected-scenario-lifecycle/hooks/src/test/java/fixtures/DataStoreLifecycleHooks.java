package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterSpec;
import com.thoughtworks.gauge.AfterSuite;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeSpec;
import com.thoughtworks.gauge.BeforeSuite;
import com.thoughtworks.gauge.datastore.ScenarioDataStore;
import com.thoughtworks.gauge.datastore.SpecDataStore;
import com.thoughtworks.gauge.datastore.SuiteDataStore;

public class DataStoreLifecycleHooks {

    private static final String KEY = "fixture";

    @BeforeSuite
    public void dataStoreBeforeSuite() {
        if (!LifecycleLog.isCase("data-stores")) {
            return;
        }
        log("BeforeSuite");
        SuiteDataStore.put(KEY, "suite");
        SpecDataStore.put(KEY, "spec-stale");
        ScenarioDataStore.put(KEY, "suite-stale");
    }

    @BeforeSpec
    public void dataStoreBeforeSpec() {
        if (!LifecycleLog.isCase("data-stores")) {
            return;
        }
        log("BeforeSpec");
        SpecDataStore.put(KEY, "spec");
        ScenarioDataStore.put(KEY, "spec-stale");
    }

    @BeforeScenario
    public void dataStoreBeforeScenario() {
        if (!LifecycleLog.isCase("data-stores")) {
            return;
        }
        log("BeforeScenario");
        ScenarioDataStore.put(KEY, "scenario");
    }

    @AfterScenario
    public void dataStoreAfterScenario() {
        log("AfterScenario");
    }

    @AfterSpec
    public void dataStoreAfterSpec() {
        log("AfterSpec");
    }

    @AfterSuite
    public void dataStoreAfterSuite() {
        log("AfterSuite");
    }

    private static void log(String phase) {
        if (!LifecycleLog.isCase("data-stores")) {
            return;
        }
        LifecycleLog.append(
            phase
                + ":suite=" + SuiteDataStore.get(KEY)
                + ",spec=" + SpecDataStore.get(KEY)
                + ",scenario=" + ScenarioDataStore.get(KEY)
        );
    }
}
