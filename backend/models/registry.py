"""
Model Registry — จุดเดียวที่ต้องแก้เมื่อ finalize ว่าชุดทดสอบไหนใช้โมเดลอะไร

โครงสร้าง:
    PATTERN_CONFIG[pattern_key] = {
        "label": ชื่อที่แสดงในหน้าเว็บ,
        "criteria": [ {criterion, model_type, model_path, threshold(optional)} , ... ]
    }

model_type ที่รองรับ: "sklearn", "sklearn_bundle" (.pkl/.joblib), "torch_bundle" (.pt แบบ
dict bundle มี state_dict/arch/threshold/mean/std/img_size — ดู models/loader.py) หรือ "formula"
ทุก path เป็น relative จากโฟลเดอร์ backend/models/weights/
"""

PATTERN_CONFIG = {
    "TG18-CT": {
        "label": "TG18-CT",
        "criteria": [
            {
                "criterion": "CT-LUM",
                "name": "การประเมินความส่องสว่างด้วย Luminance Patches",
                "model_type": "sklearn_bundle",  # โมเดล Q1.1 จริง (GBT + isotonic calibration)
                "model_path": "Q1.joblib",
                "feature_fn": "extract_luminance_features",
            },
        ],
    },
    "TG18-QC": {
        "label": "TG18-QC",
        "criteria": [
            {
                "criterion": "QC-RES",
                "name": "ความสามารถในการแยกรายละเอียดในโทนสว่าง",
                "model_type": "formula",  # สูตร mode(ผืนผ้าล่าง) - mode(จตุรัสกลาง) >= 0 ผ่าน — ไม่ใช่ ML
                "model_path": None,
                "feature_fn": "extract_resolution_features",
            },
            {
                "criterion": "QC-DARK",
                "name": "ความสามารถมองเห็นตัวอักษรคอนทราสต์ต่ำในโทนมืด",
                "model_type": "torch_bundle",  # โมเดลจริง (ResNet18) Q4.6
                "model_path": "QC-DARK.pt",
                "feature_fn": "extract_lowcontrast_dark_features",
            },
            {
                "criterion": "QC-BRIGHT",
                "name": "ความสามารถมองเห็นตัวอักษรคอนทราสต์ต่ำในโทนสว่าง",
                "model_type": "torch_bundle",  # โมเดลจริง (ResNet18) Q4.8
                "model_path": "QC-BRIGHT.pt",
                "feature_fn": "extract_lowcontrast_bright_features",
            },
        ],
    },
    "TG18-UNL80": {
        "label": "TG18-UNL80 (Uniformity, high luminance)",
        "criteria": [
            {
                "criterion": "Q2",
                "name": "Luminance uniformity (formula-based)",
                "model_type": "formula",  # ตามที่ปรึกษาแนะนำ: ใช้สูตร TG18 แทน ML
                "model_path": None,
                "feature_fn": "extract_uniformity_features",
            },
        ],
    },
    "TG18-UNL10": {
        "label": "TG18-UNL10 (Uniformity, low luminance)",
        "criteria": [
            {
                "criterion": "Q2",
                "name": "Luminance uniformity (formula-based)",
                "model_type": "formula",
                "model_path": None,
                "feature_fn": "extract_uniformity_features",
            },
        ],
    },
}

WEIGHTS_DIR = "models/weights"
