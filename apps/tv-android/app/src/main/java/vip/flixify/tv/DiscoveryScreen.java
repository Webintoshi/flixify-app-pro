package vip.flixify.tv;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import vip.flixify.tv.TvModels.*;

/** The vertical surface and every horizontal shelf recycle their visible artwork holders. */
final class DiscoveryScreen extends RecyclerView {
    interface Actions {
        void play(Item item);
        void information(Item item);
        void favorite(Item item,Button button);
        boolean isFavorite(Item item);
        void focused(Item item);
        void sidebar();
        void toolbar();
        void bind(ImageView image,Item item);
        void unbind(ImageView image);
    }
    private static final int HERO=0,EMPTY=1,RAIL=2,HEADING=3,POSTER=4;
    private static final class Node {
        final int type;final String id,title;final List<Item> items;final Item item;
        Node(int type,String id,String title,List<Item> items,Item item){this.type=type;this.id=id;this.title=title;this.items=items;this.item=item;}
    }
    private static final class Location {
        final int node,index,part;
        Location(int node,int index,int part){this.node=node;this.index=index;this.part=part;}
    }
    private final TvLayout sizing;
    private final Actions actions;
    private final List<Node> nodes=new ArrayList<>();
    private final Map<View,Location> locations=new IdentityHashMap<>();
    private final List<Item> heroes;
    private final GridLayoutManager layout;
    private final int columns;
    private final int estimatedViewportHeight;
    private String selectedHero,rememberedFocus="";
    private int archiveStart=-1;

    DiscoveryScreen(Context context,TvLayout sizing,int viewportHeight,CatalogShowcase.Result showcase,List<Item> archive,String archiveTitle,boolean emptyHero,String selectedHero,Actions actions){
        super(context);this.sizing=sizing;this.actions=actions;heroes=showcase.hero;this.selectedHero=selectedHero;
        estimatedViewportHeight=TvUi.dp(context,viewportHeight);
        setTag("tv-discovery");setId(View.generateViewId());setClipToPadding(false);setPadding(0,dp(4),0,dp(18));setItemAnimator(null);setFocusable(false);setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);
        columns=sizing.columns();layout=new GridLayoutManager(context,columns);setLayoutManager(layout);setHasFixedSize(true);setItemViewCacheSize(4);
        if(!heroes.isEmpty())nodes.add(new Node(HERO,"hero","",heroes,null));
        else if(emptyHero)nodes.add(new Node(EMPTY,"empty-hero","2026 seçkisi hazırlanıyor",null,null));
        for(CatalogShowcase.Rail rail:showcase.rails)if(!"series-other".equals(rail.id) && (!rail.id.startsWith("home-") || !rail.items.isEmpty()))nodes.add(new Node(RAIL,rail.id,rail.title,rail.items,null));
        if(archive!=null && !archive.isEmpty()){
            nodes.add(new Node(HEADING,"archive-heading",archiveTitle,null,null));archiveStart=nodes.size();
            for(Item item:archive)nodes.add(new Node(POSTER,"archive:"+item.key(),"",null,item));
        }
        layout.setSpanSizeLookup(new GridLayoutManager.SpanSizeLookup(){@Override public int getSpanSize(int position){return nodes.get(position).type==POSTER?1:columns;}});
        setAdapter(new SurfaceAdapter());
    }
    boolean isDescendant(View view){for(View current=view;current!=null;){if(current==this)return true;android.view.ViewParent parent=current.getParent();current=parent instanceof View?(View)parent:null;}return false;}
    String selectedHero(){Item item=featured();return item==null?"":item.key();}
    String focusPath(View view){Location location=locations.get(view);return location==null?rememberedFocus:path(location);}
    int scrollOffset(){View first=getChildAt(0);return first==null?0:first.getTop()-getPaddingTop();}
    private String path(Location at){Node node=nodes.get(at.node);return node.id+"/"+at.part+"/"+(node.type==POSTER?node.item.key():node.type==RAIL?node.items.get(at.index).key():node.type==HERO && at.part==2?heroes.get(at.index).key():String.valueOf(at.index));}
    private Item featured(){for(Item item:heroes)if(item.key().equals(selectedHero))return item;return heroes.isEmpty()?null:heroes.get(0);}
    void restore(int position,int offset,String focus,boolean requestFocus){
        layout.scrollToPositionWithOffset(Math.max(0,Math.min(position,nodes.size()-1)),offset);
        if(requestFocus)post(()->{if(!focusPath(focus))focusFirst();});
    }
    boolean focusItem(String key){for(int n=0;n<nodes.size();n++){Node node=nodes.get(n);if(node.type==POSTER && node.item.key().equals(key)){request(n,0,0);return true;}}for(int n=0;n<nodes.size();n++){Node node=nodes.get(n);if(node.type==RAIL)for(int i=0;i<node.items.size();i++)if(node.items.get(i).key().equals(key)){request(n,i,0);return true;}}return false;}
    private boolean focusPath(String wanted){if(wanted==null || wanted.isEmpty())return false;for(int n=0;n<nodes.size();n++){Node node=nodes.get(n);if(node.type==HERO){for(int part=1;part<=2;part++){int count=part==1?3:heroes.size();for(int i=0;i<count;i++){Location location=new Location(n,i,part);if(path(location).equals(wanted)){request(n,i,part);return true;}}}}else if(node.type==POSTER){Location at=new Location(n,0,0);if(path(at).equals(wanted)){request(n,0,0);return true;}}else if(node.type==RAIL)for(int i=0;i<node.items.size();i++){Location at=new Location(n,i,0);if(path(at).equals(wanted)){request(n,i,0);return true;}}}return false;}
    void focusFirst(){for(int n=0;n<nodes.size();n++)if(focusable(nodes.get(n))){request(n,0,nodes.get(n).type==HERO?1:0);return;}actions.toolbar();}
    private static boolean focusable(Node node){return node.type==HERO || node.type==POSTER || node.type==RAIL && !node.items.isEmpty();}
    boolean moveFocus(View view,int direction){
        Location at=locations.get(view);if(at==null)return false;Node node=nodes.get(at.node);
        if(node.type==HERO){
            int count=at.part==1?3:heroes.size();
            if(direction==View.FOCUS_LEFT){if(at.index==0)actions.sidebar();else request(at.node,at.index-1,at.part);return true;}
            if(direction==View.FOCUS_RIGHT){if(at.index+1<count)request(at.node,at.index+1,at.part);return true;}
            if(direction==View.FOCUS_UP){if(at.part==2)request(at.node,0,1);else actions.toolbar();return true;}
            if(direction==View.FOCUS_DOWN && at.part==1 && heroes.size()>1){request(at.node,0,2);return true;}
        }else if(node.type==RAIL){
            if(direction==View.FOCUS_LEFT){if(at.index==0)actions.sidebar();else request(at.node,at.index-1,0);return true;}
            if(direction==View.FOCUS_RIGHT){if(at.index+1<node.items.size())request(at.node,at.index+1,0);return true;}
        }else if(node.type==POSTER){
            int index=at.node-archiveStart,column=index%columns;
            if(direction==View.FOCUS_LEFT){if(column==0)actions.sidebar();else request(at.node-1,0,0);return true;}
            if(direction==View.FOCUS_RIGHT){if(column<columns-1 && at.node+1<nodes.size())request(at.node+1,0,0);return true;}
            if(direction==View.FOCUS_UP){
                if(index>=columns){request(at.node-columns,0,0);return true;}
                for(int n=archiveStart-1;n>=0;n--)if(focusable(nodes.get(n))){Node previous=nodes.get(n);request(n,previous.type==RAIL?Math.min(column,previous.items.size()-1):0,previous.type==HERO?1:0);return true;}
                actions.toolbar();return true;
            }
            if(direction==View.FOCUS_DOWN){if(at.node+columns<nodes.size())request(at.node+columns,0,0);return true;}
        }
        int step=direction==View.FOCUS_UP?-1:1;
        for(int n=at.node+step;n>=0 && n<nodes.size();n+=step)if(focusable(nodes.get(n))){Node next=nodes.get(n);request(n,next.type==RAIL?Math.min(at.index,next.items.size()-1):0,next.type==HERO?1:0);return true;}
        if(step<0)actions.toolbar();return true;
    }
    private void request(int node,int index,int part){
        rememberedFocus=path(new Location(node,index,part));
        ViewHolder holder=findViewHolderForAdapterPosition(node);
        if(holder==null){layout.scrollToPositionWithOffset(node,dp(8));postOnAnimation(()->requestAttached(node,index,part,0));}
        else requestAttached(node,index,part);
    }
    private void requestAttached(int node,int index,int part){requestAttached(node,index,part,0);}
    private void requestAttached(int node,int index,int part,int attempts){
        if(!isAttachedToWindow()){if(attempts<4)postOnAnimation(()->requestAttached(node,index,part,attempts+1));return;}
        ViewHolder holder=findViewHolderForAdapterPosition(node);if(holder==null){if(attempts<4)postOnAnimation(()->requestAttached(node,index,part,attempts+1));return;}
        if(nodes.get(node).type==RAIL){ShelfHolder shelf=(ShelfHolder)holder;RecyclerView.ViewHolder card=shelf.list.findViewHolderForAdapterPosition(index);if(card==null){shelf.list.scrollToPosition(index);if(attempts<4)shelf.list.postOnAnimation(()->requestAttached(node,index,part,attempts+1));}else card.itemView.requestFocus();}
        else if(nodes.get(node).type==HERO){HeroHolder hero=(HeroHolder)holder;List<Button> targets=part==2?hero.selectors:hero.buttons;if(index<targets.size())targets.get(index).requestFocus();}
        else holder.itemView.requestFocus();
    }
    private int dp(float value){return TvUi.dp(getContext(),value);}
    private int cardHeight(boolean shelf,boolean live){
        int measured=isLaidOut() && getHeight()>0?getHeight():estimatedViewportHeight;
        int available=Math.round((measured-getPaddingTop()-getPaddingBottom())/getResources().getDisplayMetrics().density)-(shelf?58:12);
        int preferred=shelf?(live?150:sizing.compact?224:250):Math.max(175,Math.min(290,Math.round((sizing.contentWidth()/columns-18)*1.5f)+62));
        return Math.max(64,Math.min(preferred,available));
    }
    private TextView heading(String text,int size){TextView view=TvUi.text(getContext(),text,size,TvUi.WHITE);TvUi.heading(view);view.setSingleLine(true);view.setEllipsize(TextUtils.TruncateAt.END);return view;}
    private void image(ImageView image,Item item){actions.bind(image,item);if(item.kind==Kind.LIVE){image.setBackground(TvUi.rounded(getContext(),Color.WHITE,0,9,1));image.setScaleType(ImageView.ScaleType.FIT_CENTER);int pad=dp(13);image.setPadding(pad,pad,pad,pad);}else image.setBackground(TvUi.rounded(getContext(),TvUi.PANEL,0,9,1));}
    private void locate(View view,int node,int index,int part,Item item){
        locations.put(view,new Location(node,index,part));view.setOnFocusChangeListener((v,focused)->{v.setElevation(dp(focused?6:0));if(focused){Location at=locations.get(v);if(at!=null)rememberedFocus=path(at);if(item!=null)actions.focused(item);}});
    }
    private void release(View view){locations.remove(view);view.setOnFocusChangeListener(null);if(view instanceof ImageView)actions.unbind((ImageView)view);if(view instanceof ViewGroup)for(int n=0;n<((ViewGroup)view).getChildCount();n++)release(((ViewGroup)view).getChildAt(n));}
    private final class SurfaceAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder>{
        @Override public int getItemViewType(int position){return nodes.get(position).type;}
        @Override public int getItemCount(){return nodes.size();}
        @Override public RecyclerView.ViewHolder onCreateViewHolder(ViewGroup parent,int type){
            if(type==HERO)return new HeroHolder();if(type==RAIL)return new ShelfHolder();if(type==POSTER)return new CardHolder(false);
            LinearLayout container=TvUi.column(getContext());container.setPadding(dp(5),dp(type==EMPTY?14:8),dp(5),dp(8));container.setLayoutParams(new RecyclerView.LayoutParams(-1,dp(type==EMPTY?104:44)));
            TextView title=heading("",type==EMPTY?23:21);container.addView(title,new LinearLayout.LayoutParams(-1,-2));if(type==EMPTY){TextView hint=TvUi.text(getContext(),"Tüm içeriklere arama, film ve dizi arşivlerinden ulaşabilirsin.",14,TvUi.MUTED);container.addView(hint,new LinearLayout.LayoutParams(-1,-2));}return new RecyclerView.ViewHolder(container){};
        }
        @Override public void onBindViewHolder(RecyclerView.ViewHolder holder,int position){Node node=nodes.get(position);if(holder instanceof HeroHolder)((HeroHolder)holder).bind(position);else if(holder instanceof ShelfHolder)((ShelfHolder)holder).bind(position);else if(holder instanceof CardHolder)((CardHolder)holder).bind(node.item,position,0,false);else{holder.itemView.setTag(node.id);((TextView)((ViewGroup)holder.itemView).getChildAt(0)).setText(node.title);}}
        @Override public void onViewRecycled(RecyclerView.ViewHolder holder){if(holder instanceof ShelfHolder)((ShelfHolder)holder).list.setAdapter(null);release(holder.itemView);}
    }
    private final class CardHolder extends RecyclerView.ViewHolder{
        final ImageView cover;final TextView title,category;
        CardHolder(boolean shelf){super(TvUi.column(getContext()));LinearLayout card=(LinearLayout)itemView;card.setId(View.generateViewId());card.setFocusable(true);card.setFocusableInTouchMode(true);card.setSoundEffectsEnabled(false);card.setBackground(TvUi.artworkBackground(getContext()));card.setPadding(dp(3),dp(3),dp(3),dp(3));
            cover=new ImageView(getContext());cover.setClipToOutline(true);cover.setScaleType(ImageView.ScaleType.CENTER_CROP);card.addView(cover,new LinearLayout.LayoutParams(-1,0,1));title=heading("",14);title.setSingleLine(false);title.setMaxLines(2);title.setPadding(dp(4),dp(5),dp(4),0);card.addView(title,new LinearLayout.LayoutParams(-1,dp(40)));category=TvUi.text(getContext(),"",11,TvUi.MUTED);category.setSingleLine(true);category.setEllipsize(TextUtils.TruncateAt.END);category.setPadding(dp(4),0,dp(4),0);card.addView(category,new LinearLayout.LayoutParams(-1,dp(18)));}
        void bind(Item item,int node,int index,boolean shelf){
            boolean live=item.kind==Kind.LIVE;int width=shelf?(live?168:sizing.compact?116:136):-1;int height=cardHeight(shelf,live);
            RecyclerView.LayoutParams params=new RecyclerView.LayoutParams(width<0?-1:dp(width),dp(height));params.setMargins(dp(4),dp(4),dp(4),dp(8));itemView.setLayoutParams(params);itemView.setTag(item.key());itemView.setContentDescription(item.title);title.setText(item.title);category.setText(live?"Canlı TV":item.categoryName);image(cover,item);locate(itemView,node,index,0,item);itemView.setOnClickListener(v->actions.play(item));
        }
    }
    private final class ShelfHolder extends RecyclerView.ViewHolder{
        final TextView title,empty;final RecyclerView list;
        ShelfHolder(){super(TvUi.column(getContext()));LinearLayout root=(LinearLayout)itemView;root.setPadding(0,dp(6),0,dp(2));root.setLayoutParams(new RecyclerView.LayoutParams(-1,-2));title=heading("",21);title.setPadding(dp(5),0,0,0);root.addView(title,new LinearLayout.LayoutParams(-1,dp(34)));list=new RecyclerView(getContext());list.setId(View.generateViewId());list.setLayoutManager(new LinearLayoutManager(getContext(),HORIZONTAL,false));list.setItemAnimator(null);list.setClipToPadding(false);list.setFocusable(false);list.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);list.setItemViewCacheSize(2);root.addView(list,new LinearLayout.LayoutParams(-1,dp(258)));empty=TvUi.text(getContext(),"Bu seçkide kullanılabilir içerik henüz bulunmuyor.",14,TvUi.MUTED);empty.setPadding(dp(5),0,0,0);root.addView(empty,new LinearLayout.LayoutParams(-1,dp(42)));}
        void bind(int position){Node node=nodes.get(position);itemView.setTag("tv-rail-"+node.id);title.setText(node.title);boolean live=!node.items.isEmpty() && node.items.get(0).kind==Kind.LIVE;ViewGroup.LayoutParams params=list.getLayoutParams();params.height=dp(cardHeight(true,live)+16);list.setLayoutParams(params);list.setVisibility(node.items.isEmpty()?View.GONE:View.VISIBLE);empty.setVisibility(node.items.isEmpty()?View.VISIBLE:View.GONE);list.setAdapter(new RecyclerView.Adapter<CardHolder>(){
            @Override public int getItemCount(){return node.items.size();}
            @Override public CardHolder onCreateViewHolder(ViewGroup parent,int type){return new CardHolder(true);}
            @Override public void onBindViewHolder(CardHolder holder,int index){holder.bind(node.items.get(index),position,index,true);}
            @Override public void onViewRecycled(CardHolder holder){release(holder.itemView);}
        });}
    }
    private final class HeroHolder extends RecyclerView.ViewHolder{
        final FrameLayout frame;final ImageView ambient,poster;final LinearLayout story,selection;final TextView metadata,title,category;final List<Button> buttons=new ArrayList<>(),selectors=new ArrayList<>();
        HeroHolder(){super(new FrameLayout(getContext()));frame=(FrameLayout)itemView;frame.setTag("tv-discovery-hero");frame.setBackground(TvUi.rounded(getContext(),TvUi.PANEL,0,14,1));frame.setClipToOutline(true);frame.setLayoutParams(new RecyclerView.LayoutParams(-1,dp(248)));
            ambient=new ImageView(getContext());ambient.setScaleType(ImageView.ScaleType.CENTER_CROP);ambient.setAlpha(.32f);frame.addView(ambient,new FrameLayout.LayoutParams(-1,-1));View shade=new View(getContext());shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,new int[]{TvUi.BACKGROUND,TvUi.alpha(TvUi.BACKGROUND,230),TvUi.alpha(TvUi.BACKGROUND,80)}));frame.addView(shade,new FrameLayout.LayoutParams(-1,-1));
            poster=new ImageView(getContext());poster.setScaleType(ImageView.ScaleType.CENTER_CROP);poster.setClipToOutline(true);FrameLayout.LayoutParams posterSpace=new FrameLayout.LayoutParams(dp(sizing.compact?100:116),dp(sizing.compact?150:174),Gravity.RIGHT|Gravity.TOP);posterSpace.setMargins(0,dp(12),dp(16),0);frame.addView(poster,posterSpace);
            story=TvUi.column(getContext());story.setGravity(Gravity.CENTER_VERTICAL);story.setPadding(dp(20),dp(10),dp(12),dp(8));FrameLayout.LayoutParams storySpace=new FrameLayout.LayoutParams(Math.max(dp(220),dp(sizing.contentWidth()-(sizing.compact?138:154))),dp(186),Gravity.LEFT|Gravity.TOP);frame.addView(story,storySpace);
            metadata=TvUi.text(getContext(),"",13,TvUi.ACCENT);story.addView(metadata,new LinearLayout.LayoutParams(-1,dp(22)));title=heading("",sizing.compact?24:30);title.setSingleLine(false);title.setMaxLines(2);story.addView(title,new LinearLayout.LayoutParams(-1,-2));category=TvUi.text(getContext(),"",13,TvUi.MUTED);category.setMaxLines(1);category.setEllipsize(TextUtils.TruncateAt.END);story.addView(category,new LinearLayout.LayoutParams(-1,dp(25)));
            LinearLayout actionsRow=TvUi.row(getContext());story.addView(actionsRow,new LinearLayout.LayoutParams(-1,dp(42)));String[] labels={"İzle","İncele","♡"};String[] tags={"tv-home-hero-play","tv-home-hero-info","tv-home-hero-favorite"};int[] widths={sizing.compact?70:86,sizing.compact?64:72,sizing.compact?38:42};
            for(int n=0;n<labels.length;n++){
                Button button=TvUi.button(getContext(),labels[n],()->{});button.setTextSize(n==2?23:13);button.setMinHeight(0);button.setMinimumHeight(0);button.setPadding(dp(8),0,dp(8),0);button.setTag(tags[n]);
                if(n==0){StateListDrawable background=new StateListDrawable();background.addState(new int[]{android.R.attr.state_focused},TvUi.rounded(getContext(),TvUi.WHITE,TvUi.ACCENT,22,2));background.addState(new int[]{android.R.attr.state_pressed},TvUi.rounded(getContext(),TvUi.alpha(TvUi.WHITE,220),0,22,1));background.addState(new int[]{},TvUi.rounded(getContext(),TvUi.WHITE,0,22,1));button.setBackground(background);button.setTextColor(TvUi.BACKGROUND);}else button.setBackground(TvUi.utilityBackground(getContext()));
                LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(dp(widths[n]),dp(42));p.rightMargin=dp(5);actionsRow.addView(button,p);buttons.add(button);
            }
            selection=TvUi.row(getContext());selection.setGravity(Gravity.CENTER_VERTICAL|Gravity.START);selection.setPadding(dp(16),0,dp(12),dp(6));FrameLayout.LayoutParams choices=new FrameLayout.LayoutParams(-1,dp(56),Gravity.BOTTOM);frame.addView(selection,choices);
        }
        void bind(int node){Item item=featured();if(item==null)return;selectedHero=item.key();image(ambient,item);ambient.setAlpha(.32f);image(poster,item);metadata.setText((item.releaseYear>0?item.releaseYear+" · ":"")+(item.kind==Kind.SERIES?"Dizi":"Film"));title.setText(item.title.replaceAll("\\s*(?:\\(2026\\)|\\[2026\\])\\s*$",""));category.setText(item.categoryName);
            for(int n=0;n<buttons.size();n++)locate(buttons.get(n),node,n,1,item);buttons.get(0).setOnClickListener(v->actions.play(featured()));buttons.get(1).setOnClickListener(v->actions.information(featured()));Button favorite=buttons.get(2);favorite.setText(actions.isFavorite(item)?"♥":"♡");favorite.setContentDescription(actions.isFavorite(item)?"Favorilerden çıkar":"Favorilere ekle");favorite.setOnClickListener(v->actions.favorite(featured(),favorite));
            for(int n=0;n<selection.getChildCount();n++)release(selection.getChildAt(n));selectors.clear();selection.removeAllViews();selection.setVisibility(heroes.size()>1?View.VISIBLE:View.GONE);
            int choiceWidth=Math.min(166,Math.max(64,(sizing.contentWidth()-40)/Math.max(1,heroes.size())-6));
            for(int n=0;n<heroes.size() && heroes.size()>1;n++){
                Item candidate=heroes.get(n);FrameLayout card=new FrameLayout(getContext());card.setBackground(TvUi.rounded(getContext(),TvUi.alpha(TvUi.PANEL,220),TvUi.alpha(TvUi.WHITE,25),8,1));card.setClipToOutline(true);
                LinearLayout contents=TvUi.row(getContext());contents.setPadding(dp(3),dp(3),dp(5),dp(3));card.addView(contents,new FrameLayout.LayoutParams(-1,-1));ImageView thumbnail=new ImageView(getContext());thumbnail.setContentDescription(null);thumbnail.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);thumbnail.setClipToOutline(true);contents.addView(thumbnail,new LinearLayout.LayoutParams(dp(30),dp(44)));image(thumbnail,candidate);
                TextView caption=TvUi.text(getContext(),candidate.title.replaceAll("\\s*(?:\\(2026\\)|\\[2026\\])\\s*$",""),11,TvUi.WHITE);caption.setMaxLines(2);caption.setEllipsize(TextUtils.TruncateAt.END);caption.setPadding(dp(6),0,0,0);caption.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);contents.addView(caption,new LinearLayout.LayoutParams(0,-1,1));
                Button choice=TvUi.button(getContext(),"",()->{});choice.setMinHeight(0);choice.setMinimumHeight(0);choice.setPadding(0,0,0,0);choice.setBackground(TvUi.artworkBackground(getContext()));choice.setSelected(candidate.key().equals(item.key()));choice.setContentDescription(candidate.title+" öne çıkar");choice.setTag("tv-hero-choice-"+candidate.key());card.addView(choice,new FrameLayout.LayoutParams(-1,-1));int index=n;choice.setOnClickListener(v->{selectedHero=candidate.key();bind(node);selectors.get(index).requestFocus();});LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(dp(choiceWidth),dp(50));p.rightMargin=dp(6);selection.addView(card,p);selectors.add(choice);locate(choice,node,n,2,candidate);
            }
        }
    }
}
