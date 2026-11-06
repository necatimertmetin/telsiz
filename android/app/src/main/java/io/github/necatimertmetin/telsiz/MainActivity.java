package io.github.necatimertmetin.telsiz;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TelsizPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
