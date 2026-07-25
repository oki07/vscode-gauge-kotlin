package fixtures;

import com.thoughtworks.gauge.ClassInitializer;

public class FixtureClassInitializer implements ClassInitializer {

    @Override
    public Object initialize(Class<?> classToInitialize) throws Exception {
        if (isStateCase() && classToInitialize.equals(StateLifecycleFixture.class)) {
            LifecycleLog.append("Initialize:" + classToInitialize.getSimpleName());
        }
        return classToInitialize.getDeclaredConstructor().newInstance();
    }

    private static boolean isStateCase() {
        return LifecycleLog.isCase("state-scenario")
            || LifecycleLog.isCase("state-spec");
    }
}
