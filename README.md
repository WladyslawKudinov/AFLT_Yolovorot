# YOLOvorot
### Масштабируемый подход для быстрого учета авиационных инструментов
[Презентация проекта](https://drive.google.com/file/d/12ors8TRcopY6fetjMhVjhEw1wrp60uh2/view?usp=sharing)

https://github.com/user-attachments/assets/365914d6-1a5f-4d8a-949f-9d9235fe6af6



### Интерфейс
<img width="2507" height="1459" alt="image_2025-10-19_21-25-38" src="https://github.com/user-attachments/assets/a46e535d-1e22-4f88-8dd7-93d87a7eca14" />

---

### 🧪 Synthetic dataset generation — [`Vlad's part - Addition for AITH/`](./Vlad's%20part%20-%20Addition%20for%20AITH/)

My main contribution: the **synthetic data generation pipeline** that produced
the training data for the tool-recognition model. With almost no real labelled
imagery of the ~87 aviation tools, I generated thousands of composited images
**with pixel-accurate YOLO segmentation labels for free** — the labels come from
the compositing geometry, not from manual annotation.

- **AI-generated backgrounds** — realistic empty Aeroflot workbench/tool-cart
  surfaces via Replicate, plus background replacement on real photos that
  preserves existing YOLO boxes.
- **Compositing engine** — pastes transparent tool cut-outs onto backgrounds
  with random scale/rotation/count and class balancing, deriving polygon masks
  straight from each cut-out's alpha channel.
- **Dual labels** — `labels_seg0` (tool-vs-background) and `labels_cls30`
  (per-tool class ids 30–86); QA via segmentation overlays.

See the [folder README](./Vlad's%20part%20-%20Addition%20for%20AITH/README.md)
for the full pipeline, runnable `compose_dataset.py`, and a 15-image sample of
the generated dataset.
