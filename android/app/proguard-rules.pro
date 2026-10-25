# Le pont JavaScript : les methodes @JavascriptInterface doivent survivre a R8.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
