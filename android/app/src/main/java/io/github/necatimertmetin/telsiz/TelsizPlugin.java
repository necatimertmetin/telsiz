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
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
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

    // Radyoda çalan şarkı: yayının içine gömülü "StreamTitle" okunur (tarayıcı bunu engeller).
    // En fazla 400 KB ve 10 sn okunur, sonra bağlantı kapanır.
    @PluginMethod
    public void radioTitle(PluginCall call) {
        String u = call.getString("url");
        if (u == null || !u.startsWith("https://")) { call.resolve(new JSObject()); return; }
        new Thread(() -> {
            JSObject r = new JSObject();
            java.net.HttpURLConnection c = null;
            try {
                c = (java.net.HttpURLConnection) new URL(u).openConnection();
                c.setRequestProperty("Icy-MetaData", "1");
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                InputStream in = c.getInputStream();
                byte[] buf = new byte[400000];
                int n = 0;
                long end = System.currentTimeMillis() + 10000;
                byte[] key = "StreamTitle='".getBytes("US-ASCII");
                int start = -1, scanned = 0;
                while (n < buf.length && System.currentTimeMillis() < end) {
                    int k = in.read(buf, n, Math.min(16384, buf.length - n));
                    if (k < 0) break;
                    n += k;
                    if (start < 0) {
                        for (int i = Math.max(0, scanned - key.length); i + key.length <= n && start < 0; i++) {
                            boolean hit = true;
                            for (int j = 0; j < key.length; j++) if (buf[i + j] != key[j]) { hit = false; break; }
                            if (hit) start = i + key.length;
                        }
                        scanned = n;
                    }
                    if (start < 0) continue;
                    int e = -1;
                    for (int i = start; i + 1 < n; i++) if (buf[i] == '\'' && buf[i + 1] == ';') { e = i; break; }
                    if (e < 0) continue;
                    byte[] t = java.util.Arrays.copyOfRange(buf, start, e);
                    String s = new String(t, "UTF-8");
                    if (s.indexOf((char) 0xFFFD) >= 0) s = new String(t, "windows-1254");
                    r.put("title", s.length() > 200 ? s.substring(0, 200) : s);
                    break;
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
            call.resolve(r);
        }).start();
    }

    @PluginMethod
    public void appVersion(PluginCall call) {
        try {
            JSObject r = new JSObject();
            r.put("version", getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName);
            call.resolve(r);
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("Sürüm okunamadı", e);
        }
    }

    // APK indirilir, Android kurulum ekranı açılır. Son onayı sistem ister.
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("Adres yok"); return; }
        new Thread(() -> {
            try {
                File apk = new File(getContext().getCacheDir(), "telsiz-update.apk");
                try (InputStream in = new URL(url).openStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("Güncelleme indirilemedi", e);
            }
        }).start();
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
