use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub profiles: HashMap<String, serde_json::Value>,
    pub model_mappings: HashMap<String, String>,
}

pub fn resolve_behavior_class(config: &ModelConfig, model_name: &str) -> Option<String> {
    for (pattern, class) in &config.model_mappings {
        if wildcard_match(pattern, model_name) {
            return Some(class.clone());
        }
    }
    None
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    if let Some(prefix) = pattern.strip_suffix('*') {
        value.starts_with(prefix)
    } else {
        value == pattern
    }
}

pub fn should_auto_tune(sample_count: u64) -> bool {
    sample_count >= 50 && sample_count % 50 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_behavior_class_uses_wildcard_mapping() {
        let config = ModelConfig {
            profiles: std::collections::HashMap::new(),
            model_mappings: std::collections::HashMap::from([(
                "claude-opus-4-*".to_string(),
                "opus".to_string(),
            )]),
        };

        let class = resolve_behavior_class(&config, "claude-opus-4-20260301");
        assert_eq!(class.as_deref(), Some("opus"));
    }
}
