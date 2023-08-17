use ckb_sdk_examples_env::Env;
use std::io::Result;
use std::{thread, time};

fn main() -> Result<()> {
    let _env = Env::try_new()?;

    thread::sleep(time::Duration::from_secs(5));

    Ok(())
}
