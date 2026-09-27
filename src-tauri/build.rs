fn main() {
    // tauri-build は icons/icon.ico を exe に埋め込むが、そのファイルを rerun-if-changed に
    // 登録しない（2.6 時点）。アイコンだけ差し替えても再ビルドされず古い絵が残るので、
    // ここで明示する
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
