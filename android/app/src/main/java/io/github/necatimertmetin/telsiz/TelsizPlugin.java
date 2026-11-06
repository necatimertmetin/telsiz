package io.github.necatimertmetin.telsiz;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "Telsiz")
public class TelsizPlugin extends Plugin {
    private final Map<String, OutputStream> open = new HashMap<>();
    private int nextHandle = 1;

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private boolean headsetConnected() {
        for (AudioDeviceInfo d : audio().getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            int t = d.getType();
            if (t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                || t == AudioDeviceInfo.TYPE_USB_HEADSET) return true;
        }
        return false;
    }

    private void routeSpeaker(boolean on) {
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!on) { am.clearCommunicationDevice(); return; }
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) { am.setCommunicationDevice(d); return; }
            }
        } else {
            am.setSpeakerphoneOn(on);
        }
    }

    @PluginMethod
    public void callStart(PluginCall call) {
        Context c = getContext();
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7001);
        }
        ContextCompat.startForegroundService(c, new Intent(c, CallService.class));
        audio().setMode(AudioManager.MODE_IN_COMMUNICATION);
        // Kulaklık takılı değilse telefon kulağa değil hoparlöre çalsın.
        routeSpeaker(!headsetConnected());
        call.resolve();
    }

    @PluginMethod
    public void callStop(PluginCall call) {
        Context c = getContext();
        c.stopService(new Intent(c, CallService.class));
        routeSpeaker(false);
        audio().setMode(AudioManager.MODE_NORMAL);
        call.resolve();
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        routeSpeaker(Boolean.TRUE.equals(call.getBoolean("on", true)));
        call.resolve();
    }

    @PluginMethod
    public void fileOpen(PluginCall call) {
        String name = call.getString("name", "dosya").replaceAll("[/\\\\]", "_");
        String type = call.getString("type", "application/octet-stream");
        try {
            OutputStream out;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, type);
                Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                out = getContext().getContentResolver().openOutputStream(uri);
            } else {
                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                out = new FileOutputStream(new File(dir, name));
            }
            String handle = String.valueOf(nextHandle++);
            open.put(handle, out);
            JSObject r = new JSObject();
            r.put("handle", handle);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Dosya açılamadı", e);
        }
    }

    @PluginMethod
    public void fileWrite(PluginCall call) {
        OutputStream out = open.get(call.getString("handle", ""));
        if (out == null) { call.reject("Geçersiz dosya"); return; }
        try {
            out.write(Base64.decode(call.getString("b64", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("Yazılamadı", e);
        }
    }

    @PluginMethod
    public void fileClose(PluginCall call) {
        OutputStream out = open.remove(call.getString("handle", ""));
        try {
            if (out != null) out.close();
            call.resolve();
        } catch (Exception e) {
            call.reject("Kapatılamadı", e);
        }
    }
}
