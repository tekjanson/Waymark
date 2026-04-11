# Add project specific ProGuard rules here.
-keep class com.waymark.app.** { *; }

# OkHttp — suppress missing class warnings
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# WebRTC
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
