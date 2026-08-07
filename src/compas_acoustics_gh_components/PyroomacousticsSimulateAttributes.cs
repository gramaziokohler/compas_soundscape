using System;
using System.Drawing;
using System.Windows.Forms;
using Grasshopper.GUI;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Attributes;

namespace CompasAcoustics
{
    /// <summary>
    /// Karamba-style collapsible on-canvas settings panel. Rendered directly in
    /// the component attributes: a material dropdown, mono/FOA mode toggle,
    /// two checkboxes and three sliders. All values live in
    /// PyroomacousticsSimulateComponent.Settings.
    ///
    /// The header row is ALWAYS visible: collapsed = header row only, so
    /// toggling can never make the panel vanish.
    ///
    /// All text is drawn with Graphics.DrawString (GDI+), NOT TextRenderer
    /// (GDI) — GDI ignores the GH canvas zoom/pan transform and the text
    /// lands off-view. Keep it that way.
    ///
    /// Layout WIDENS Bounds after base.Layout() when the component's natural
    /// width (driven by the I/O nicknames) is narrower than the settings
    /// panel needs. When it does, it also shifts every output param's
    /// Attributes.Bounds by the same delta, so the output sockets/gizmos and
    /// their draggable hit-areas move together and stay in sync with the new
    /// right edge — never widen Bounds without doing this, or wire dragging
    /// on the outputs breaks.
    /// </summary>
    public class PyroomacousticsSimulateAttributes : GH_ComponentAttributes
    {
        // =====================================================================
        //  UI TUNING — change these to re-scale the panel.
        //
        //  FontSize ..... label size in pixels. GH's own labels are ~11px.
        //                 Raise to 12-13 for larger text, 10 for denser.
        //  RowHeights ... one entry per panel row, top to bottom:
        //                 [Header, Material, Mode, Ray, Air, Rays, MaxOrder, RIR]
        //  HeaderHeight . collapsed panel height = just the "SETTINGS ▾" row.
        //  LabelSpace ... px reserved for the row labels ("Material", "Rays: 10000").
        //                 The control (dropdown/slider) gets the rest of the row.
        //  ControlMinWidth ... narrowest a control may be. The panel is widened
        //                 (see Layout) so the label is never actually cut by this.
        //  ToggleWidth .. width of each of the two Mode buttons (mono / foa).
        //  CtrlHeight ... control box height (slider track / dropdown box).
        //  ControlGap ... breathing room between a row's label and its control.
        //  Margin ....... inner gutter on the left / right of each row.
        //
        //  The panel width is the wider of: the component's natural width
        //  (from the longest input/output nickname), and MinPanelWidth below,
        //  which is derived from Margin/LabelSpace/ControlMinWidth/ToggleWidth
        //  so no row's control can ever overlap its label.
        // =====================================================================

        private const float FontSize = 11f;
        private static readonly Font UiFont = new Font(GH_FontServer.Standard.FontFamily, FontSize, GraphicsUnit.Pixel);
        private static readonly Font UiFontBold = new Font(UiFont, FontStyle.Bold);

        private static readonly float[] RowHeights = { 18, 18, 18, 18, 18, 20, 20, 20 };
        private const float HeaderHeight = 18f;
        private const float LabelSpace = 95f;
        private const float ControlMinWidth = 60f;
        private const float ToggleWidth = 42f;
        private const float CtrlHeight = 15f;
        private const float ControlGap = 4f;
        private const float Margin = 6f;

        // Smallest panel width that lets every row's control clear its label
        // (the widest control is the two Mode toggle buttons at ToggleWidth*2).
        private const float MinPanelWidth = 2f * Margin + LabelSpace + ControlGap + (ToggleWidth * 2f > ControlMinWidth ? ToggleWidth * 2f : ControlMinWidth);

        private const int ROW_HEADER = 0;
        private const int ROW_MATERIAL = 1;
        private const int ROW_MODE = 2;
        private const int ROW_RAY = 3;
        private const int ROW_AIR = 4;
        private const int ROW_RAYS = 5;
        private const int ROW_MAXORDER = 6;
        private const int ROW_RIR = 7;

        private static readonly Color PanelBg = Color.FromArgb(210, 28, 28, 30);
        private static readonly Color PanelBorder = Color.FromArgb(120, 255, 255, 255);
        private static readonly Color TextColor = Color.FromArgb(235, 240, 240, 240);
        private static readonly Color DimText = Color.FromArgb(170, 200, 200, 200);
        private static readonly Color Accent = Color.FromArgb(255, 200, 130, 70);
        private static readonly Color ControlBg = Color.FromArgb(150, 60, 60, 65);
        private static readonly Color ControlBgHover = Color.FromArgb(180, 80, 80, 90);

        private RectangleF _panelRect = RectangleF.Empty;
        private int _dragRow = -1;

        public PyroomacousticsSimulateAttributes(GH_Component Comp)
            : base(Comp)
        {
        }

        private PyroomacousticsSimulateComponent Comp
        {
            get { return base.Owner as PyroomacousticsSimulateComponent; }
        }

        // ---- layout -------------------------------------------------------

        protected override void Layout()
        {
            base.Layout();
            _panelRect = RectangleF.Empty;
            var comp = Comp;
            if (comp == null || comp.Settings == null) return;

            float panelHeight = comp.Settings.PanelOpen ? FullPanelHeight : HeaderHeight;
            var b = Bounds;

            // If the component's natural width (from its I/O nicknames) is
            // narrower than the panel needs, widen it here — and shift every
            // output param's Bounds right by the same amount, so the output
            // sockets/gizmos and their hit-areas track the new right edge
            // instead of staying pinned to the old, narrower one.
            if (b.Width < MinPanelWidth)
            {
                float dx = MinPanelWidth - b.Width;
                foreach (var output in Owner.Params.Output)
                {
                    var ob = output.Attributes.Bounds;
                    ob.X += dx;
                    output.Attributes.Bounds = ob;
                }
                b.Width = MinPanelWidth;
            }

            // Panel spans the (possibly widened) component width.
            _panelRect = new RectangleF(b.X, b.Bottom, b.Width, panelHeight);
            Bounds = new RectangleF(b.X, b.Y, b.Width, b.Height + panelHeight);
        }

        private static float FullPanelHeight
        {
            get
            {
                float h = 0;
                for (int i = 0; i < RowHeights.Length; i++) h += RowHeights[i];
                return h;
            }
        }

        // ---- rendering ----------------------------------------------------

        protected override void Render(GH_Canvas canvas, Graphics graphics, GH_CanvasChannel channel)
        {
            base.Render(canvas, graphics, channel);
            if (channel != GH_CanvasChannel.Objects) return;
            var comp = Comp;
            if (comp == null || comp.Settings == null) return;

            using (var bg = new SolidBrush(PanelBg))
                graphics.FillRectangle(bg, _panelRect);
            using (var border = new Pen(PanelBorder))
            {
                graphics.DrawLine(border, _panelRect.X, _panelRect.Y, _panelRect.Right, _panelRect.Y);
                graphics.DrawLine(border, _panelRect.X, _panelRect.Bottom - 1, _panelRect.Right, _panelRect.Bottom - 1);
            }

            DrawHeader(graphics, comp);
            if (!comp.Settings.PanelOpen) return;

            DrawMaterialRow(graphics, comp);
            DrawModeRow(graphics, comp);
            DrawCheckboxRow(graphics, "Ray tracing", ROW_RAY, comp.Settings.RayTracing);
            DrawCheckboxRow(graphics, "Air absorption", ROW_AIR, comp.Settings.AirAbsorption);
            DrawSliderRow(graphics, "Rays", ROW_RAYS, comp.Settings.NRays, 1000, 100000, "0");
            DrawSliderRow(graphics, "Max order", ROW_MAXORDER, comp.Settings.MaxOrder, 0, 8, "0");
            DrawSliderRow(graphics, "RIR dur", ROW_RIR, comp.Settings.RirDuration, 0.5, 5.0, "0.0");
        }

        private void DrawHeader(Graphics g, PyroomacousticsSimulateComponent comp)
        {
            var r = RowRect(ROW_HEADER);
            string text = comp.Settings.PanelOpen ? "SETTINGS  \u25BE" : "SETTINGS  \u25B8";
            DrawText(g, text, UiFontBold, TextColor,
                new RectangleF(r.X + Margin, r.Y, r.Width - 2 * Margin, r.Height));
        }

        private void DrawMaterialRow(Graphics g, PyroomacousticsSimulateComponent comp)
        {
            var r = RowRect(ROW_MATERIAL);
            DrawText(g, "Material", UiFont, TextColor,
                new RectangleF(r.X + Margin, r.Y, LabelSpace, r.Height));

            var c = CtrlRect(ROW_MATERIAL);
            using (var b = new SolidBrush(ControlBg))
                g.FillRectangle(b, c);
            var name = MaterialCatalog.DisplayName(comp.Settings.SelectedMaterialId);
            if (string.IsNullOrEmpty(name)) name = comp.Settings.SelectedMaterialId;
            DrawText(g, name, UiFont, TextColor,
                new RectangleF(c.X + 4, c.Y, c.Width - 16, c.Height));
            DrawText(g, "\u25BE", UiFont, DimText,
                new RectangleF(c.Right - 13, c.Y, 12, c.Height));
        }

        private void DrawModeRow(Graphics g, PyroomacousticsSimulateComponent comp)
        {
            var r = RowRect(ROW_MODE);
            DrawText(g, "Mode", UiFont, TextColor,
                new RectangleF(r.X + Margin, r.Y, LabelSpace, r.Height));

            var mono = ToggleRect(ROW_MODE, 0);
            var foa = ToggleRect(ROW_MODE, 1);
            bool isMono = comp.Settings.SimulationMode == "mono";

            using (var b = new SolidBrush(isMono ? Accent : ControlBg))
                g.FillRectangle(b, mono);
            using (var b = new SolidBrush(!isMono ? Accent : ControlBg))
                g.FillRectangle(b, foa);
            using (var b = new SolidBrush(Color.Black))
            {
                g.DrawString("mono", UiFont, b, CenterText(g, mono, "mono", UiFont));
                g.DrawString("foa", UiFont, b, CenterText(g, foa, "foa", UiFont));
            }
        }

        private void DrawCheckboxRow(Graphics g, string label, int row, bool value)
        {
            var r = RowRect(row);
            DrawText(g, label, UiFont, TextColor,
                new RectangleF(r.X + Margin, r.Y, LabelSpace, r.Height));

            var box = CheckRect(row);
            using (var b = new SolidBrush(value ? Accent : ControlBg))
                g.FillRectangle(b, box);
            // Always draw an outline, same as the sliders — otherwise an
            // unchecked box (translucent dark grey) is nearly invisible
            // against the equally dark, translucent panel background.
            using (var pen = new Pen(ControlBgHover))
                g.DrawRectangle(pen, box.X, box.Y, box.Width - 1, box.Height - 1);
            if (value)
            {
                using (var b = new SolidBrush(Color.Black))
                {
                    var pts = new PointF[]
                    {
                        new PointF(box.X + 3, box.Y + box.Height / 2f),
                        new PointF(box.X + box.Width / 2f - 1, box.Bottom - 3),
                        new PointF(box.Right - 2, box.Y + 3)
                    };
                    g.DrawLines(new Pen(b, 1.6f), pts);
                }
            }
        }

        private void DrawSliderRow(Graphics g, string label, int row, double value, double min, double max, string format)
        {
            var r = RowRect(row);
            DrawText(g, label + ": " + value.ToString(format), UiFont, TextColor,
                new RectangleF(r.X + Margin, r.Y, LabelSpace, r.Height));

            var c = CtrlRect(row);
            using (var b = new SolidBrush(ControlBg))
                g.FillRectangle(b, c);
            double frac = (value - min) / (max - min);
            if (frac < 0) frac = 0; if (frac > 1) frac = 1;
            float w = (float)(c.Width * frac);
            if (w > 2)
            {
                using (var b = new SolidBrush(Accent))
                    g.FillRectangle(b, c.X, c.Y, w, c.Height);
            }
            using (var pen = new Pen(ControlBgHover))
                g.DrawRectangle(pen, c.X, c.Y, c.Width - 1, c.Height - 1);
        }

        // ---- rect helpers -------------------------------------------------

        private RectangleF RowRect(int row)
        {
            float y = _panelRect.Y;
            for (int i = 0; i < row; i++) y += RowHeights[i];
            return new RectangleF(_panelRect.X, y, _panelRect.Width, RowHeights[row]);
        }

        private RectangleF CtrlRect(int row)
        {
            var r = RowRect(row);
            // Subtract BOTH margins (left gutter used by the label rect, and
            // the right gutter used by the control rect) plus a small gap,
            // so the control starts flush after the label instead of
            // overlapping its tail end.
            float available = _panelRect.Width - (2f * Margin) - LabelSpace - ControlGap;
            float w = Math.Max(ControlMinWidth, available);
            float x = _panelRect.Right - Margin - w;
            float y = r.Y + (r.Height - CtrlHeight) / 2f;
            return new RectangleF(x, y, w, CtrlHeight);
        }

        private RectangleF ToggleRect(int row, int index)
        {
            var r = RowRect(row);
            float w = ToggleWidth;
            float x = _panelRect.Right - Margin - w * 2 + index * w;
            float y = r.Y + (r.Height - CtrlHeight) / 2f;
            return new RectangleF(x, y, w - 2, CtrlHeight);
        }

        private RectangleF CheckRect(int row)
        {
            var r = RowRect(row);
            float y = r.Y + (r.Height - 14) / 2f;
            return new RectangleF(_panelRect.Right - Margin - 14, y, 14, 14);
        }

        private static PointF CenterText(Graphics g, RectangleF r, string text, Font font)
        {
            var sz = g.MeasureString(text, font);
            return new PointF(r.X + (r.Width - sz.Width) / 2f, r.Y + (r.Height - sz.Height) / 2f);
        }

        /// <summary>
        /// GDI+ text — respects the GH canvas transform (TextRenderer does not).
        /// Vertically centered in <paramref name="rect"/>; overflow is elided.
        /// </summary>
        private static void DrawText(Graphics g, string text, Font font, Color color, RectangleF rect)
        {
            var fmt = new StringFormat(StringFormat.GenericTypographic);
            fmt.Alignment = StringAlignment.Near;
            fmt.LineAlignment = StringAlignment.Center;
            fmt.Trimming = StringTrimming.EllipsisCharacter;
            fmt.FormatFlags |= StringFormatFlags.NoWrap;
            using (var b = new SolidBrush(color))
                g.DrawString(text, font, b, rect, fmt);
        }

        // ---- interaction --------------------------------------------------

        public override GH_ObjectResponse RespondToMouseDown(GH_Canvas sender, GH_CanvasMouseEvent e)
        {
            var comp = Comp;
            if (comp == null || comp.Settings == null) return base.RespondToMouseDown(sender, e);

            if (_panelRect.Contains(e.CanvasLocation))
            {
                if (e.Button == MouseButtons.Left)
                {
                    int row = HitTest(e.CanvasLocation);
                    if (row >= 0) HandleRowClick(comp, row, e);
                    return _dragRow >= 0 ? GH_ObjectResponse.Capture : GH_ObjectResponse.Handled;
                }
                return GH_ObjectResponse.Handled;
            }
            return base.RespondToMouseDown(sender, e);
        }

        public override GH_ObjectResponse RespondToMouseMove(GH_Canvas sender, GH_CanvasMouseEvent e)
        {
            var comp = Comp;
            if (_dragRow >= 0 && comp != null && comp.Settings != null)
            {
                HandleSliderDrag(comp, _dragRow, e.CanvasLocation.X);
                return GH_ObjectResponse.Capture;
            }
            return base.RespondToMouseMove(sender, e);
        }

        public override GH_ObjectResponse RespondToMouseUp(GH_Canvas sender, GH_CanvasMouseEvent e)
        {
            if (_dragRow >= 0)
            {
                int row = _dragRow;
                _dragRow = -1;
                var comp = Comp;
                if (comp != null) Expire(comp);
                else Grasshopper.Instances.RedrawCanvas();
                return GH_ObjectResponse.Release;
            }
            return base.RespondToMouseUp(sender, e);
        }

        private int HitTest(PointF pt)
        {
            for (int i = 0; i < RowHeights.Length; i++)
            {
                if (RowRect(i).Contains(pt)) return i;
            }
            return -1;
        }

        private void HandleRowClick(PyroomacousticsSimulateComponent comp, int row, GH_CanvasMouseEvent e)
        {
            switch (row)
            {
                case ROW_HEADER:
                    comp.Settings.PanelOpen = !comp.Settings.PanelOpen;
                    Expire(comp);
                    break;
                case ROW_MATERIAL:
                    ShowMaterialMenu(comp);
                    break;
                case ROW_MODE:
                    if (ToggleRect(ROW_MODE, 0).Contains(e.CanvasLocation))
                        comp.Settings.SimulationMode = "mono";
                    else if (ToggleRect(ROW_MODE, 1).Contains(e.CanvasLocation))
                        comp.Settings.SimulationMode = "foa";
                    Expire(comp);
                    break;
                case ROW_RAY:
                    comp.Settings.RayTracing = !comp.Settings.RayTracing;
                    Expire(comp);
                    break;
                case ROW_AIR:
                    comp.Settings.AirAbsorption = !comp.Settings.AirAbsorption;
                    Expire(comp);
                    break;
                case ROW_RAYS:
                case ROW_MAXORDER:
                case ROW_RIR:
                    HandleSliderDrag(comp, row, e.CanvasLocation.X);
                    _dragRow = row;
                    break;
            }
        }

        private void HandleSliderDrag(PyroomacousticsSimulateComponent comp, int row, float mouseX)
        {
            var c = CtrlRect(row);
            double frac = (mouseX - c.X) / c.Width;
            if (frac < 0) frac = 0; if (frac > 1) frac = 1;

            switch (row)
            {
                case ROW_RAYS:
                    comp.Settings.NRays = 1000 + (int)(frac * (100000 - 1000));
                    break;
                case ROW_MAXORDER:
                    comp.Settings.MaxOrder = (int)Math.Round(frac * 8.0);
                    break;
                case ROW_RIR:
                    comp.Settings.RirDuration = Math.Round(0.5 + frac * 4.5, 1);
                    break;
            }
            Grasshopper.Instances.RedrawCanvas();
        }

        private void ShowMaterialMenu(PyroomacousticsSimulateComponent comp)
        {
            var menu = new ContextMenuStrip();
            menu.Font = UiFont;

            if (MaterialCatalog.Materials.Count == 0)
            {
                var msg = MaterialCatalog.HasLoaded
                    ? "No materials received from backend."
                    : "Materials not loaded - is the backend running?";
                menu.Items.Add(msg).Enabled = false;
            }
            else
            {
                foreach (var m in MaterialCatalog.Materials)
                {
                    var item = new ToolStripMenuItem(m.Name)
                    {
                        Tag = m.Id,
                        Checked = string.Equals(m.Id, comp.Settings.SelectedMaterialId, StringComparison.OrdinalIgnoreCase)
                    };
                    var id = m.Id;
                    item.Click += (s, ev) =>
                    {
                        comp.Settings.SelectedMaterialId = id;
                        Expire(comp);
                    };
                    menu.Items.Add(item);
                }
            }
            menu.Show(Cursor.Position);
        }

        private void Expire(PyroomacousticsSimulateComponent comp)
        {
            comp.ExpireSolution(true);
            Grasshopper.Instances.RedrawCanvas();
        }
    }
}