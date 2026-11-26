
package com.pocketflow.app;

import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import go.Seq;
import mobile.Mobile;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "PocketFlow";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            // Initialize the Go runtime with Android's application context.
            Seq.setContext(getApplicationContext());

            // Start the Go backend and store SQLite in private app storage.
            String error = Mobile.startServer(
                getFilesDir().getAbsolutePath()
            );

            if (error != null && !error.isEmpty()) {
                Log.e(TAG, "Go backend failed to start: " + error);
            } else {
                Log.i(TAG, "Go backend started on port " + Mobile.port());
            }

        } catch (Exception e) {
            Log.e(TAG, "Could not initialize PocketFlow backend", e);
        }
    }
}
