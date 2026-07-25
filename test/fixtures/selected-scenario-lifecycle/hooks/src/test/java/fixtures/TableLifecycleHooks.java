package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterSpec;
import com.thoughtworks.gauge.AfterSuite;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeSpec;
import com.thoughtworks.gauge.BeforeSuite;
import com.thoughtworks.gauge.datastore.ScenarioDataStore;

public class TableLifecycleHooks {

    private static final String KEY = "table-fixture";

    @BeforeSuite
    public void tableBeforeSuite() {
        log("BeforeSuite");
    }

    @BeforeSpec
    public void tableBeforeSpec() {
        log("BeforeSpec");
    }

    @BeforeScenario
    public void tableBeforeScenario() {
        if (!isTableCase()) {
            return;
        }
        LifecycleLog.append(
            "BeforeScenario:scenario=" + ScenarioDataStore.get(KEY)
        );
        ScenarioDataStore.put(KEY, "set");
    }

    @AfterScenario
    public void tableAfterScenario() {
        if (isTableCase()) {
            LifecycleLog.append(
                "AfterScenario:scenario=" + ScenarioDataStore.get(KEY)
            );
        }
    }

    @AfterSpec
    public void tableAfterSpec() {
        log("AfterSpec");
    }

    @AfterSuite
    public void tableAfterSuite() {
        log("AfterSuite");
    }

    private static boolean isTableCase() {
        return LifecycleLog.isCase("spec-table")
            || LifecycleLog.isCase("scenario-table");
    }

    private static void log(String event) {
        if (isTableCase()) {
            LifecycleLog.append(event);
        }
    }
}
