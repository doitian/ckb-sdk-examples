use std::io::Result;
use std::process::{Child, Command};

pub struct Env {
    pub ckb: Child,
}

impl Env {
    pub fn try_new() -> Result<Env> {
        Command::new("bin/ckb-node.sh")
            .spawn()
            .map(|child| Env { ckb: child })
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        if let Err(e) = self.ckb.kill() {
            println!("Could not kill child process: {}", e)
        }
    }
}
