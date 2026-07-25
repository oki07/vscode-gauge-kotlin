package example;

import com.thoughtworks.gauge.Step;
import com.thoughtworks.gauge.datastore.ScenarioDataStore;
import com.thoughtworks.gauge.datastore.SpecDataStore;
import com.thoughtworks.gauge.datastore.SuiteDataStore;

public class DataStoreScenarioSteps {

    private static final String KEY = "fixture";

    @Step("Read the selected data stores.")
    public void readSelectedDataStores() {
        if (!LifecycleLog.isCase("data-stores")) {
            return;
        }
        LifecycleLog.append(
            "Step"
                + ":suite=" + SuiteDataStore.get(KEY)
                + ",spec=" + SpecDataStore.get(KEY)
                + ",scenario=" + ScenarioDataStore.get(KEY)
        );
    }
}
