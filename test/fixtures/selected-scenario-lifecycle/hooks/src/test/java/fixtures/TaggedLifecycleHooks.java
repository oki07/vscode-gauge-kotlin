package fixtures;

import com.thoughtworks.gauge.AfterScenario;
import com.thoughtworks.gauge.AfterSpec;
import com.thoughtworks.gauge.AfterStep;
import com.thoughtworks.gauge.AfterSuite;
import com.thoughtworks.gauge.BeforeScenario;
import com.thoughtworks.gauge.BeforeSpec;
import com.thoughtworks.gauge.BeforeStep;
import com.thoughtworks.gauge.BeforeSuite;
import com.thoughtworks.gauge.ExecutionContext;
import com.thoughtworks.gauge.Operator;

public class TaggedLifecycleHooks {

    @BeforeSuite
    public void aBeforeSuite() {
        log("aBeforeSuite");
    }

    @BeforeSuite
    public void zBeforeSuite() {
        log("zBeforeSuite");
    }

    @BeforeSpec
    public void aBeforeSpec(ExecutionContext context) {
        log("BeforeSpecContext:" + context.getCurrentSpecification().getName());
    }

    @BeforeSpec
    public void zBeforeSpec() {
        log("zBeforeSpec");
    }

    @BeforeSpec(tags = {"spec-tag"})
    public void bTaggedBeforeSpec() {
        log("bTaggedBeforeSpec");
    }

    @BeforeSpec(tags = {"missing-tag"})
    public void ignoredBeforeSpec() {
        log("ignoredBeforeSpec");
    }

    @BeforeSpec(tags = {"spec-tag"})
    public void yTaggedBeforeSpec() {
        log("yTaggedBeforeSpec");
    }

    @BeforeScenario
    public void aBeforeScenario(ExecutionContext context) {
        log("BeforeScenarioContext:" + context.getCurrentScenario().getName());
    }

    @BeforeScenario
    public void zBeforeScenario() {
        log("zBeforeScenario");
    }

    @BeforeScenario(tags = {"spec-tag", "scenario-tag"})
    public void bAndBeforeScenario() {
        log("bAndBeforeScenario");
    }

    @BeforeScenario(tags = {"missing-tag", "scenario-tag"}, tagAggregation = Operator.OR)
    public void cOrBeforeScenario() {
        log("cOrBeforeScenario");
    }

    @BeforeScenario(tags = {"missing-tag"})
    public void ignoredBeforeScenario() {
        log("ignoredBeforeScenario");
    }

    @BeforeStep
    public void aBeforeStep(ExecutionContext context) {
        log("BeforeStepContext:" + context.getCurrentStep().getText());
    }

    @BeforeStep
    public void zBeforeStep() {
        log("zBeforeStep");
    }

    @BeforeStep(tags = {"spec-tag", "scenario-tag"})
    public void bAndBeforeStep() {
        log("bAndBeforeStep");
    }

    @BeforeStep(tags = {"missing-tag", "scenario-tag"}, tagAggregation = Operator.OR)
    public void cOrBeforeStep() {
        log("cOrBeforeStep");
    }

    @BeforeStep(tags = {"missing-tag"})
    public void ignoredBeforeStep() {
        log("ignoredBeforeStep");
    }

    @AfterStep
    public void aAfterStep(ExecutionContext context) {
        log("AfterStepContext:" + context.getCurrentStep().getText());
    }

    @AfterStep
    public void zAfterStep() {
        log("zAfterStep");
    }

    @AfterStep(tags = {"spec-tag", "scenario-tag"})
    public void bAndAfterStep() {
        log("bAndAfterStep");
    }

    @AfterStep(tags = {"missing-tag", "scenario-tag"}, tagAggregation = Operator.OR)
    public void cOrAfterStep() {
        log("cOrAfterStep");
    }

    @AfterStep(tags = {"missing-tag"})
    public void ignoredAfterStep() {
        log("ignoredAfterStep");
    }

    @AfterScenario
    public void aAfterScenario(ExecutionContext context) {
        log("AfterScenarioContext:" + context.getCurrentScenario().getName());
    }

    @AfterScenario
    public void zAfterScenario() {
        log("zAfterScenario");
    }

    @AfterScenario(tags = {"spec-tag", "scenario-tag"})
    public void bAndAfterScenario() {
        log("bAndAfterScenario");
    }

    @AfterScenario(tags = {"missing-tag", "scenario-tag"}, tagAggregation = Operator.OR)
    public void cOrAfterScenario() {
        log("cOrAfterScenario");
    }

    @AfterScenario(tags = {"missing-tag"})
    public void ignoredAfterScenario() {
        log("ignoredAfterScenario");
    }

    @AfterSpec
    public void aAfterSpec(ExecutionContext context) {
        log("AfterSpecContext:" + context.getCurrentSpecification().getName());
    }

    @AfterSpec
    public void zAfterSpec() {
        log("zAfterSpec");
    }

    @AfterSpec(tags = {"spec-tag"})
    public void bTaggedAfterSpec() {
        log("bTaggedAfterSpec");
    }

    @AfterSpec(tags = {"missing-tag"})
    public void ignoredAfterSpec() {
        log("ignoredAfterSpec");
    }

    @AfterSpec(tags = {"spec-tag"})
    public void yTaggedAfterSpec() {
        log("yTaggedAfterSpec");
    }

    @AfterSuite
    public void aAfterSuite() {
        log("aAfterSuite");
    }

    @AfterSuite
    public void zAfterSuite() {
        log("zAfterSuite");
    }

    private static void log(String event) {
        if (LifecycleLog.isCase("tagged-order")) {
            LifecycleLog.append(event);
        }
    }
}
