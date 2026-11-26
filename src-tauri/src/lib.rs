use std::net::TcpStream;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct ServerChild(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerChild(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let data_dir_str = data_dir.to_string_lossy().to_string();

            // Só inicia o sidecar se a porta 127.0.0.1:3001 ainda não estiver ocupada (ex: dev externo)
            if TcpStream::connect("127.0.0.1:3001").is_err() {
                match app.shell().sidecar("binaries/playhub-server") {
                    Ok(cmd) => match cmd.env("PLAYHUB_DATA_DIR", data_dir_str).spawn() {
                        Ok((_rx, child)) => {
                            if let Ok(mut guard) = app.state::<ServerChild>().0.lock() {
                                *guard = Some(child);
                            }
                        }
                        Err(err) => {
                            log::error!("Falha ao iniciar sidecar playhub-server: {}", err);
                        }
                    },
                    Err(err) => {
                        log::error!("Sidecar playhub-server não encontrado: {}", err);
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut guard) = app_handle.state::<ServerChild>().0.lock() {
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
