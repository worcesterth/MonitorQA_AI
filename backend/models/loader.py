"""
โหลดโมเดลแบบ lazy + cache ไว้ใน memory (โหลดครั้งเดียวตอน request แรกของแต่ละไฟล์)
รองรับ sklearn (.pkl/.joblib ผ่าน joblib), sklearn_bundle (.joblib แบบ dict bundle
มี model/features/threshold ในตัว — ใช้กับโมเดล Q1.1 จริง) และ torch_bundle (.pt แบบ dict
มี state_dict/arch/threshold/mean/std/img_size ในตัว — ใช้กับโมเดล QC-DARK/QC-BRIGHT จริง
ResNet18 ไบนารีคลาสสิฟายเออร์ที่รับภาพ crop เข้าไปตรง ๆ)
"""
import os
import cv2
import numpy as np
import joblib

from .registry import WEIGHTS_DIR

_CACHE = {}


def _full_path(model_path: str) -> str:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
    return os.path.join(here, WEIGHTS_DIR, model_path)


def load_model(model_type: str, model_path: str):
    if model_type == "formula":
        return None  # ไม่มีโมเดล ML ให้โหลด ใช้สูตรคำนวณตรง ๆ

    key = (model_type, model_path)
    if key in _CACHE:
        return _CACHE[key]

    path = _full_path(model_path)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"ไม่พบไฟล์โมเดล: {path}\n"
            f"→ วางไฟล์ .pkl/.pt ของคุณไว้ที่ backend/{WEIGHTS_DIR}/{model_path}"
        )

    if model_type in ("sklearn", "sklearn_bundle"):
        model = joblib.load(path)
    elif model_type == "torch_bundle":
        import torch
        import torch.nn as nn
        from torchvision.models import resnet18

        bundle = torch.load(path, map_location="cpu", weights_only=False)
        if bundle.get("arch") != "resnet18":
            raise ValueError(f"arch ไม่รองรับ: {bundle.get('arch')} (รองรับแค่ resnet18)")
        net = resnet18(weights=None)
        net.fc = nn.Linear(net.fc.in_features, 1)
        net.load_state_dict(bundle["state_dict"])
        net.eval()
        model = {**{k: v for k, v in bundle.items() if k != "state_dict"}, "model": net}
    else:
        raise ValueError(f"model_type ไม่รู้จัก: {model_type}")

    _CACHE[key] = model
    return model


def predict(model_type: str, model, features):
    """
    features: numpy array 1 แถว (1, n_features) สำหรับ sklearn,
              dict ของ {feature_name: value} สำหรับ sklearn_bundle,
              หรือภาพ crop grayscale (numpy array 2D, ยังไม่ resize/normalize) สำหรับ torch_bundle
              — predict() จะ resize เป็น img_size, แปลง RGB, normalize ด้วย mean/std ของ bundle เอง
    คืนค่า: (label: "Pass"/"Fail", confidence: float 0-1)
    """
    if model_type == "sklearn":
        pred = model.predict(features)[0]
        if hasattr(model, "predict_proba"):
            proba = model.predict_proba(features)[0]
            conf = float(max(proba))
        else:
            conf = 1.0
        label = "Pass" if int(pred) == 1 else "Fail"
        return label, conf

    if model_type == "sklearn_bundle":
        # bundle = {"model", "features" (ลำดับคอลัมน์), "threshold", ...} — ดู deploy_models/Q1.json
        x = np.array([[features[c] for c in model["features"]]], dtype=float)
        prob_fail = float(model["model"].predict_proba(x)[0, 1])
        threshold = model.get("threshold", 0.5)
        label = "Fail" if prob_fail >= threshold else "Pass"
        confidence = abs(prob_fail - threshold) * 2
        return label, confidence

    if model_type == "torch_bundle":
        import torch

        img_size = model["img_size"]
        resized = cv2.resize(features, (img_size, img_size), interpolation=cv2.INTER_AREA)
        rgb = np.stack([resized, resized, resized], axis=-1).astype(np.float32) / 255.0
        mean = np.array(model["mean"], dtype=np.float32)
        std = np.array(model["std"], dtype=np.float32)
        normalized = (rgb - mean) / std
        tensor = torch.from_numpy(normalized.transpose(2, 0, 1)).unsqueeze(0).float()

        with torch.no_grad():
            out = model["model"](tensor)
            prob_fail = torch.sigmoid(out).item()  # positive_class ของ bundle นี้คือ "FAIL" เสมอ

        threshold = model.get("threshold", 0.5)
        label = "Fail" if prob_fail >= threshold else "Pass"
        confidence = abs(prob_fail - threshold) * 2
        return label, confidence

    raise ValueError(f"model_type ไม่รู้จัก: {model_type}")
